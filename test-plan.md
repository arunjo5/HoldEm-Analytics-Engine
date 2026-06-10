# Test coverage plan

Audit of missing test coverage (frontend 68 tests / backend 39 tests today). Gaps are prioritized:
P0 = core correctness (money math, solver math, security) · P1 = important behavior/edges · P2 = hardening.
Each case is individually assertable. Nothing here is implemented yet.

**Totals: 86 gaps (P0 30 · P1 41 · P2 15) · 524 test cases.**

> Found during audit and verified live: multiway chops over-credit equity — 3-way chop returns 50/50/50 (sum 150%). Fix tracked separately; regression tests are in the equity section below.

## Contents
1. Monte Carlo equity engine (frontend/src/pokerEngine.js, frontend/src/equityWorker.js)
2. Heads-up river CFR+ solver (frontend/src/solverEngine.js, frontend/src/solverWorker.js)
3. hand replayer engine + view + share (frontend/src/replayerEngine.js, frontend/src/Replayer.jsx, frontend/src/replayShare.js)
4. PokerNow log import (frontend/src/pokernowImport.js parser + frontend/src/UploadModal.jsx modal)
5. share links, scenario codec, range notation/pickers (frontend/src/scenario.js, frontend/src/shareCodec.js, frontend/src/Pickers.jsx)
6. frontend UI components & app shell
7. backend auth + API routes
8. backend libs (body.ts, rateLimit.ts, prisma schema) + CI pipeline
9. Cross-cutting (completeness critic)

## Monte Carlo equity engine (frontend/src/pokerEngine.js, frontend/src/equityWorker.js)

*Currently covered:* Existing tests (frontend/src/pokerEngine.test.js, frontend/src/equity.test.js) cover deterministic 2-player full-board showdowns for the major category ladder (pair+kicker, flush>straight, full house>flush, quads>full house, straight flush>quads, wheel straight, 2-way board chop, flush>trips), statistical preflop bands for AA/KK, AA/72o, AKs/22 with a 2-player equity-sum check, plus makeDeck size and expandRangeKey combo counts (6/4/12). Nothing tests range players inside simulate, more than 2 players, card conflicts, cardToId/idToCard, or equityWorker.js at all.

### [P0] Multiway tie splitting in calculate()

*Risk:* pokerEngine.js:307 computes equity as (wins + ties*0.5)/valid, which only splits 2-way: a 3-way chop yields 50% equity per player (sum 150%) instead of 33.3% — silent money-math corruption for any multiway pot, and no existing test uses more than 2 players.

- [ ] 3 players on board As Ks Qs Js Ts (royal plays for everyone) with hole cards 2h3h / 4d5d / 6c7c, sims:1 — assert each perPlayer equity is 33.33 (±0.01) and the three equities sum to 100. (Currently fails: each returns 50, sum 150 — fix the ties*0.5 formula, e.g. track per-round split or count winnerCount.)
- [ ] Same 3-way chop — assert perPlayer[i].tie === 100 for all three players (this part is correct today and should keep passing after the equity fix).
- [ ] 4 players all playing that same board, sims:1 — assert each equity is 25 and sum is 100 (currently 50 each / 200 total).
- [ ] Statistical: calculate([AA, KK, QQ as fixed hands], [], {sims:50000}) — assert equities sum to 100 ± 0.5 (the sum invariant catches multiway-tie overcounting even when ties are rare) and AA equity is within ±5 of 65.
- [ ] 2-player sanity invariant on any preflop run: ties[0] === ties[1] is implied, so assert perPlayer[0].tie === perPlayer[1].tie via a deterministic chop board (already partially covered) AND that wins+tie accounting gives equity[0]+equity[1] === 100 exactly on a full-board chop with sims:1.

### [P0] Range players in simulate (kind:'range' path, lines 178–186 and 228–241)

*Risk:* The entire range-sampling code path — expandRange flattening, 20-try rejection sampling against the used0/used1 bitmasks — has zero test coverage; a regression silently corrupts every range-vs-hand equity the app shows.

- [ ] Forced single live combo is exact: P0 = {kind:'range', range:['KK']}, P1 = hand KsKh, board Qs Js 9s 2s 3h, sims:500 — only KdKc is dealable to P0 (Ks/Kh dead), P1 has the K-high spade flush, so assert perPlayer[1].equity === 100, perPlayer[0].equity === 0, and r.sims === 500. This pins both card removal (no duplicate Ks/Kh ever dealt) and rejection-sampling correctness.
- [ ] Fully blocked range terminates with zero: P0 range ['AA'], P1 hand AsAh, board Ad Ac 7c 8d 2h, sims:100 — all four aces dead, found stays 0 every iteration, so assert the call returns (bounded by the sims*50 safety cap at line 211), r.sims === 0, and all equities are 0 (not NaN).
- [ ] Statistical: range('AA') vs hand KsKh preflop, sims:40000 — assert range player's equity within ±4 of 81.9 (mirrors the existing fixed-hand AA/KK band, exercising sampling across all 6 AA combos minus removal).
- [ ] Range vs range: ['AA'] vs ['KK'], sims:40000 — assert AA side within ±4 of 81.5 and equities sum to 100 ± 0.5 (covers two sequential range samples sharing the used-card masks).
- [ ] Empty range is skipped: players [{kind:'range', range:[]}, hand AsKs, hand QdQc] — assert perPlayer has only keys '1' and '2' (the range player with range.length 0 fails the guard at line 178).

### [P0] evaluate7 — full house / two-trips boundaries

*Risk:* The trip/secondTrip/pair bookkeeping at lines 82–105 (secondary = max(secondTrip, pair1)) is untested for two-trips hands and trip-rank-first comparison; an off-by-one here misranks full houses silently.

- [ ] Two trips → higher trip plays as trips, second trip as the pair: board 7d 7c 5h 5d 5s, P0 = Ah Kd (board full house 555-77), P1 = 7h 2c (777-55) — assert P1 equity 100 (7s-full beats 5s-full; verifies trip=7/secondTrip=5 ordering from the descending loop at line 83).
- [ ] Full houses compare trips before pair: board 2c 2d Ah As 5c, P0 = 2s 9h (222-AA), P1 = Ad Td (AAA-22) — assert P1 equity 100 (score is trip<<16 | secondary<<12, so AAA-22 > 222-AA).
- [ ] Trip with no pair is NOT a full house: board Ad Ah 7s 6s 5s, P0 = As 2s (trip aces AND A-high flush), P1 = 8d 9c (9-high straight) — assert P0 equity 100. If line 101–105 wrongly emitted trips (3<<20) instead of falling through to the flush branch (5<<20), P1's straight (4<<20) would win.
- [ ] Trip + pair from a pocket pair: board Kd Kc Kh 4d 9s, P0 = 2c 2d (KKK-22), P1 = Ad Qc (KKK + A,Q kickers — trips only) — assert P0 equity 100 (full house from pair1 beats trips with kickers).

### [P0] evaluate7 — straight/flush selection edges

*Risk:* The high-descending mask scans (lines 76–79 and 123–125) and top-5 flush extraction (lines 107–117) decide thousands of close showdowns; only the basic wheel and one flush case are tested.

- [ ] Steel wheel beats quads: board 2s 3s 4s Kd Kc, P0 = As 5s (A-5 straight flush), P1 = Kh Ks (quad kings) — assert P0 equity 100 (8<<20 with high=5 vs 7<<20; exercises the ace-low bit at line 75).
- [ ] Steel wheel is the LOWEST straight flush: board 2s 3s 4s 5s 9d, P0 = As Ah (5-high SF), P1 = 6s 7d (6-high SF) — assert P1 equity 100 (descending high loop must find 6 before 5).
- [ ] Six-card straight run picks the highest top: board 5c 6d 7h 8s 2c, P0 = 9d 4h (9-high straight), P1 = 4d 3h (8-high straight) — assert P0 equity 100.
- [ ] A-2-3-4-6 is not a straight (ace doesn't wrap mid-run): board Ah 2c 3d 4s 6h, P0 = 2d 9h (pair of 2s), P1 = Kd Qd (high card) — assert P0 equity 100; a false straight for either player would flip or chop this.
- [ ] Flush top-5 extraction, 5th card decides: board Ah Kh Qh Jh 2c, P0 = 9h 3d (A K Q J 9 flush), P1 = 8h 3s (A K Q J 8 flush) — assert P0 equity 100 (verifies the count<5 shifting loop packs all five flush ranks).
- [ ] Six flush cards pick top 5: board 2h 4h 7h 9h Jh, P0 = Ah 3c, P1 = Kh Qd — assert P0 equity 100 (P0's flush A-J-9-7-4 vs P1's K-J-9-7-4; ensures the low 2h/3-card noise is dropped).

### [P0] evaluate7 — kicker ordering on paired boards

*Risk:* Quad-kicker, two-pair-from-three-pairs, and the one-pair three-kicker cutoff (lines 95–98, 138–146, 148–157) are classic silent-misrank spots and none are covered.

- [ ] Quad on board, hole kicker decides: board 8h 8d 8s 8c Qd, P0 = Ah 2c, P1 = Kd 3c — assert P0 equity 100 (kicker loop at line 97 must pick A over the board Q).
- [ ] Quad on board with board ace kicker chops: board 8h 8d 8s 8c Ad, P0 = Kh 2c, P1 = Qd 3c — assert 50/50 with tie 100 for both (neither hole card outkicks the board A).
- [ ] Three pairs → best two play, third pair rank acts as kicker: board Kd Kc Qd Qc 8h, P0 = 9s 9d (KKQQ + 9 kicker via the pocket pair), P1 = 7d 3c (KKQQ + 8 board kicker) — assert P0 equity 100 (the kicker loop at line 140 must see the 9 even though it's a paired rank not stored in pair1/pair2).
- [ ] Three pairs vs ace kicker: board Kd Kc Qd Qc 8h, P0 = 2s 2d, P1 = Ah 3c — assert P1 equity 100 (A kicker beats P0's deuces which don't play).
- [ ] One pair uses exactly three kickers: board Ad Kc Qd Jh 9c, P0 = As 4c, P1 = Ah 2d — assert a chop (both play A-pair + K,Q,J; the 4 vs 2 must NOT break the tie — line 149's k0/k1/k2 cutoff).

### [P1] simulate — conflict handling, safety cap, sparse player arrays

*Risk:* Degenerate inputs (duplicate cards, dead boards) must terminate via the maxSafety = sims*50 cap and return valid:0 rather than hanging or emitting NaN equities.

- [ ] Hand-vs-hand card conflict: calculate([hand As Kd, hand As Qd], [], {sims:100}) — assert it returns (does not hang), r.sims === 0, and all win/tie/equity are 0 (the `valid ? x : 0` guards at lines 305–307).
- [ ] Board-hand conflict: hand AsAd with board containing As — assert r.sims === 0 and equities 0.
- [ ] No conflicts means valid === requested: 2 disjoint hands on a full 5-card board, sims:1000 — assert r.sims === 1000 exactly (every iteration is valid; pins the safety loop accounting).
- [ ] All-null players: calculate([null, undefined], [], {sims:10}) — assert perPlayer is {} and sims is 0 (numActive===0 early return at line 189).
- [ ] Sparse array preserves original indices: calculate([null, hand AsAh, null, hand KsKh], full board, {sims:1}) — assert perPlayer keys are exactly ['1','3'] (PLAYER_IDX mapping at line 191).
- [ ] Player with hand.length !== 2 is skipped: players [{kind:'hand', hand:[card]}, valid hand] — assert only the valid player appears in perPlayer.
- [ ] Conflict run is time-bounded: wrap the duplicate-card case with sims:1000 in a coarse wall-clock assertion (< a few hundred ms) to pin that maxSafety stops at sims*50 iterations.

### [P1] equityWorker batching contract

*Risk:* equityWorker.js has zero tests; it is the production path for displayed equity, and it currently never terminates when simulate returns valid:0 (totalRun at line 8 never advances, so the setTimeout chain posts deltaValid:0 batches forever).

- [ ] Test harness: stub globalThis.self = { postMessage: vi.fn() } before importing equityWorker.js, invoke self.onmessage({data: {...}}) directly, and drive the setTimeout chain with vi.useFakeTimers() + vi.runAllTimers() (or repeated advanceTimersByTime(0)).
- [ ] Single-batch job: maxSims:50, batchSize:100, two disjoint hands on a full board — assert exactly one message of type 'batch' (deltaValid 50) followed by one 'done', both carrying the exact jobId passed in.
- [ ] Batch sizing with remainder: maxSims:100, batchSize:40, no conflicts — assert deltaValid sequence is [40, 40, 20] (target = Math.min(batchSize, maxSims - totalRun)) and the deltas sum to exactly 100.
- [ ] Deltas reconstruct exact totals: full deterministic board where P0 always wins, maxSims:100, batchSize:30 — assert sum of deltaWins['0'] across all batch messages === 100, sum of deltaWins['1'] === 0, and all deltaTies are 0.
- [ ] jobId isolation: every posted message (batch and done) for a job started with jobId 'job-xyz' carries jobId 'job-xyz' unchanged.
- [ ] Termination on impossible deals: players sharing a card (simulate always returns valid:0) — assert the worker eventually posts 'done' instead of looping; CURRENTLY FAILS (infinite zero-delta batches because `if (totalRun >= maxSims)` never trips). Fix needs a no-progress bail-out, then assert: finite messages and a final 'done'.
- [ ] maxSims:0 — assert an immediate 'done' with zero batch messages.

### [P1] cardToId/idToCard encoding and range-expansion details

*Risk:* evaluate7 decodes ids assuming rank = (id>>>2)+2 and suit = id&3; if cardToId's VALUE_INDEX*4+SUIT_INDEX layout ever drifts, every result corrupts silently, and nothing tests these functions directly.

- [ ] Round-trip: for all ids 0..51, cardToId(idToCard(id)) === id.
- [ ] Anchor points: cardToId({v:'2',s:'s'}) === 0, cardToId({v:'A',s:'c'}) === 51, cardToId({v:'A',s:'s'}) === 48 — pins the rank-major layout evaluate7's `(c >>> 2) + 2` decode depends on.
- [ ] Decode consistency: for each id, RANK[idToCard(id).v] === (id >>> 2) + 2.
- [ ] expandRangeKey('AKs') combos all have card[0].s === card[1].s; expandRangeKey('AKo') combos all have differing suits and contain none of the 4 suited combos.
- [ ] expandRangeKey('QQ') yields 6 combos with no combo containing the same card twice and no duplicate unordered pair across combos.
- [ ] expandRangeKey('AK') (pair-shaped key without 's'/'o' suffix) returns [] — pins the silent fall-through at lines 29–35 so a future caller can't assume it means 'both'.

### [P2] Input hardening (player cap, sims default)

*Risk:* simulate has no guard for more than MAX_PLAYERS=9 active players — typed-array writes past index 8 (PLAYER_C0/PLAYER_IDX/SCORES) are silently dropped, so a 10th player would be scored from stale buffer garbage.

- [ ] 10 active hand players: assert simulate either throws a descriptive error or (after adding a guard) truncates/handles explicitly — currently the 10th player's evaluate7 reads undefined-backed values and the result is garbage with no error.
- [ ] calculate(players, board, {sims: 0}) falls back to 100000 via `opts.sims || 100000` (line 300) — assert the intended behavior explicitly (either document the fallback or treat 0 as 0).
- [ ] calculate with opts omitted entirely defaults to 100000 sims — smoke-assert r.sims > 0 with two valid hands (use a tiny override in CI-speed tests; this case can use sims:1 with a full board plus one direct default-path call guarded by a longer timeout).
- [ ] Worker job overlap: post a second onmessage with a new jobId while the first job's timer chain is still pending — assert (and thereby document) that messages from both jobIds interleave with correct tagging, since equityWorker.js has no cancellation; consumers must filter by jobId.

## Heads-up river CFR+ solver (frontend/src/solverEngine.js, frontend/src/solverWorker.js)

*Currently covered:* No test file imports solverEngine.js or solverWorker.js — the entire CFR+ solver, its tree builder, terminal payoff math, exploitability/best-response evaluation, the buildNodeSolve UI contract, and equityMatchup are 0% covered. The existing frontend suite (pokerEngine.test.js, equity.test.js, replayerEngine.test.js, scenario.test.js, etc.) covers hand evaluation, the equity worker, replayer logic, and import/share codecs only; pokerEngine.test.js does give confidence in evaluate7/cardToId, which the solver builds on.

### [P0] Zero-sum and equilibrium invariants of solve()

*Risk:* These invariants are the only cheap way to detect silent money-math corruption anywhere in the CFR pipeline (terminal payoffs, reach weighting, Z normalization); a sign error or off-by-inv bug would ship wrong EVs with no visible failure.

- [ ] solve('Ks7d2c8h3s' board, oopKeys ['AA','KK','QQ'], ipKeys ['JJ','TT','99'], spot {pot:20, stack:80, betSizes:[33,75,125 on], allIn:true}, {iterations:256}) returns meta where evOOP + evIP === spot.pot within 1e-6 (showdown winPay+losePay and fold payoffs both telescope to the initial pot, normalized by the same Z).
- [ ] Same solve: meta.exploitPctPot >= 0 and every entry of result.trace >= 0 (Math.max(0,ev) clamp in exploitabilityPctPot).
- [ ] trace[trace.length-1] === meta.exploitPctPot exactly — both come from the same deterministic exploitabilityPctPot() on the final accumulated strat, so any drift means evalValue/avgStrat changed between trace and final computation.
- [ ] Convergence: with iterations 512 on a one-bet-size tree (betSizes [{pct:75,on:true}], allIn:false), trace[last] < trace[0] and meta.exploitPctPot < 1 (% of pot).
- [ ] Determinism: two back-to-back solve() calls with identical args produce byte-identical meta.evOOP, meta.exploitPctPot, and nodeSolves weights (no hidden randomness in the CFR loop).
- [ ] Strategy normalization: for every node id in result.nodeSolves and every combo, Object.values(combo.weights) sums to 1 within 1e-9 — covers both the normalized avgStrat branch and the strat-sum===0 fallback to 1/A.
- [ ] Best response dominates average: expose or recompute brO/brI (exploitabilityPctPot returns them) and assert brO >= evOOP - 1e-9 and brI >= evIP - 1e-9; a violation means the br===p max-over-actions branch in evalValue regressed.

### [P0] Closed-form degenerate spots (nuts vs air, board-plays chop)

*Risk:* These are the only tests with externally-known correct answers; if CFR converges to the wrong fixed point (e.g. regret update or reach split bug) all other invariants can still pass.

- [ ] Nuts vs air: board ['Qh','Jh','Th','2c','3d'], oopKeys ['AKs'] with opts.oopRestrict = Set(['AhKh']) (royal flush), ipKeys ['54o'] with opts.ipRestrict = Set(['5s4c']); after 512 iters meta.evOOP is within 0.05*pot of pot (20) and meta.evIP within 0.05*pot of 0, exploitPctPot < 1.
- [ ] Same spot: in nodeSolves.ip_vs_bet (air facing OOP rep bet), the single combo's weights.fold > 0.95.
- [ ] Reversed spot (OOP air, IP nuts): nodeSolves.oop_vs_bet nuts... invert — give IP the AhKh royal; assert in nodeSolves.ip_vs_bet... concretely: OOP '5s4c' air first to act — nodeSolves.oop_first air combo has weights.check > 0.9 (bluffing into a known royal only loses), and in the node where the nuts faces a bet, weights.fold < 0.01 with call+raise summing > 0.99.
- [ ] Board plays (everyone chops): board ['As','Ks','Qs','Js','Ts'], oopKeys ['22'] ipKeys ['33'] (no spade blockers matter — royal on board) → meta.evOOP and meta.evIP each ≈ pot/2 within 1e-6 and exploitPctPot ≈ 0 (pure tiePay = pot/2 - inv path through showdownCFV).
- [ ] Dominated showdown: OOP restricted to KhKd vs IP restricted to QhQd on board '2s7d9c4h8s' (KK always wins) → evOOP converges to ≥ pot - tolerance and evIP ≤ tolerance (full-information villain folds everything; also exercises foldCFV winner-side payoff pot - inv[me]).

### [P0] Card removal, Z normalizer, and the {empty:true} path

*Risk:* Blocked-combo handling silently skews every EV if it regresses (Z and the CFV inner loops must skip the same pairs), and the empty path is the solver's only input guard.

- [ ] Shared-card hands: oopKeys ['AKs'] restrict Set(['AsKs']), ipKeys ['AQo'] restrict Set(['AsQd']) on a board without those cards → Z===0 branch returns exactly { empty:true, oopCount:1, ipCount:1 } (no nodes/meta keys).
- [ ] Restrict combo dead on board: opts.oopRestrict = Set(['KsQs']) with Ks on the board → buildCombos drops it, solve returns empty:true with oopCount:0.
- [ ] Board removal count: oopKeys ['AA'] with one ace (As) on the board → result.oopCount === 3; with no aces on board → 6 (comboCardsFor pair expansion minus boardSet filter at line 39).
- [ ] restrictIds is order-insensitive: opts.oopRestrict = Set(['KsAs']) (reversed id) still matches the AsKs combo — line 38 checks both a+b and b+a; assert oopCount === 1.
- [ ] Mirror-range blockers: OOP ['AA'] vs IP ['AA'] on an ace-free board → Z counts only non-overlapping pairs (6*6 - blocked), all showdowns tie, evOOP === evIP === pot/2 within 1e-6 — verifies the (lo&lo)|(hi&hi) bitmask skip is consistent between the Z loop (line 166) and showdownCFV (line 181).

### [P0] equityMatchup — exact full-board path

*Risk:* This number is shown to users as hand equity and feeds solve setup decisions; an enumeration or blocker bug is silent wrong-percentage corruption.

- [ ] Hand vs hand, hero always wins: heroSide {kind:'hand', cards:[As,Ah]} vs villain {kind:'hand', cards:[Ks,Kh]} on board 2c7d9h4s8c → hero.equity === 100, hero.win === 100, method === 'exact', samples === 1, heroCount === villCount === 1.
- [ ] Chop: same hands on board AsKsQsJsTs... use non-conflicting hands e.g. 2c2d vs 3c3d on royal board → hero.tie === 100 and hero.equity === 50 (tie/2 accounting in finalizeEq).
- [ ] Hand vs range with blockers: hero AhAd vs villainSide {kind:'range', keys:['AA']} on ace-free full board → villain expands to 6 combos but the in-loop cid collision check skips pairs sharing Ah/Ad, so samples === 1 (AcAs only) and hero.tie === 100.
- [ ] Dead hero: hero hand using a board card → heroCount 0 and the early return { hero:null, villain:null, method:'exact', samples:0 }.
- [ ] total === 0 hole: hero {hand AsKs} vs villain {hand AsQd} on a full board containing neither → both combos survive the board filter but the single pair is card-blocked, total stays 0, and finalizeEq's `total || 1` returns 0% win/tie/equity for BOTH sides instead of null — pin intended behavior (should be the null shape).
- [ ] EXACT_PAIR_CAP fallback: two ranges with hc*vc > 200000 (e.g. ~470 combos each) → loop runs exactly 200000 trials with mulberry32(0x5e7) so the result is deterministic; assert samples <= 200000, equity within ~1 of the true enumerated value, and flag that method is still reported as 'exact' on line 458 despite sampling (should be 'sampled'/'simulated').

### [P1] buildTree action-set construction (clamp, dedup, all-in, rep-75 node)

*Risk:* Wrong bet amounts or a wrong rep node mean the solver answers a different game than the user configured — results look plausible but are for the wrong tree.

- [ ] Clamp + dedup: spot {pot:100, stack:30, betSizes:[33,75,125 all on], allIn:true} → all three sizes round to >= rem so all clamp to 30 and the seen-set dedups; assert nodes[0] (oop_first) has exactly 2 actions ['check', one bet] and that the surviving bet keeps id 'b33'/sizePct 33 even though it is economically an all-in (document or fix the misleading 'Bet 33%' label from actionMeta).
- [ ] amt<=0 skip: spot {pot:1, betSizes:[{pct:33,on:true}], allIn:false} → Math.round(0.33)===0 is skipped (line 71), root has only 'check'; repIdx <= 0 so ip_vs_bet and oop_vs_bet are null and result.nodes contains only 'oop_first' and 'ip_vs_check'.
- [ ] All-in appended when distinct: DEFAULT_SPOT (pot 20, stack 80, sizes 33/75/125, allIn:true) → oop_first action ids are ['check','b33','b75','b125','allin'] and the allin actionMeta is {kind:'bet', sizePct:999, label:'All-in'}.
- [ ] Rep node selection: sizes [33,125] on → meta.repBetPct === 33 (|33-75| < |125-75|) and nodes ip_vs_bet label is 'IP — facing OOP bet 33%'; sizes [50,100] → repBetPct === 50 (strict d < bestD keeps the first on a distance tie).
- [ ] Facing-bet actions and raise suppression: with stack such that the bet is all-in (pot 20, stack 15, size 75% → amt 15 === rem), ip_vs_bet actions are exactly [fold, call] — the rem > toCall guard at line 106 must drop the raise; with deep stacks the same node includes {id:'raise', kind:'raise'}.
- [ ] Raise depth cap and pot-raise sizing (export buildTree for this, it is not reachable via display nodes): after bet→raise, the next facing node's only aggressive action has id 'allin' (depth 1 branch, add = rem), and after bet→raise→allin the facing node has only fold/call (st.depth < 2 false); also assert the depth-0 raise add equals min(toCall + (pot + toCall), rem).
- [ ] stack === 0 bug: spot {pot:20, stack:0, betSizes:[{pct:75,on:true}]} → betOptions clamps amt to rem=0 AFTER the amt<=0 guard (lines 70-72), emitting a 0-chip 'bet' whose facing node lets villain fold the pot away for free; pin the intended behavior (check-only tree) with a failing-then-fixed test.

### [P1] buildNodeSolve output contract (UI data shape)

*Risk:* SolverResults renders directly from this shape; a regression in grouping/percentiles/weights mislabels strategies in the UI without any crash.

- [ ] weights keys of every combo exactly equal the node's action ids from nodes[].actions (same order-independent set), for all four display nodes on DEFAULT_SPOT.
- [ ] byKey aggregation: for a range with multiple combos per hkey (e.g. oopKeys ['KK'] → 6 combos), byKey['KK'].count === 6, agg[aid] === mean of the member combos' weights[aid] within 1e-12, and dominant === argmax of agg.
- [ ] Group combos sorted by cat descending (line 356 comparator) — feed a range whose key spans categories on the board (e.g. '77' on a 7-high board: set vs underpair combos can't differ within one key, so use a key like 'A2s' on a board where one suit makes a flush) and assert cat ordering.
- [ ] Strength percentile: with exactly 3 live combos of distinct scores, strRank is 0 for the lowest score, 1 for the highest (k/(n-1) mapping); with a single live combo str === 0.5 (side.length > 1 false branch).
- [ ] Display-time restrict filter: hand-restricted OOP → nodeSolves.oop_first.count === 1 and combos[0].id === the restricted combo id (restrictIds.has(cmb.id) check at line 339).
- [ ] nodeSolves has an entry for every id in result.nodes and none for filtered-out nulls (check-only tree from the amt<=0 case).

### [P1] equityMatchup — Monte Carlo partial-board path

*Risk:* Preflop/flop/turn equities use a separate code path (deck build, runout dealing, collision skip) that shares nothing with the exact path.

- [ ] Preflop AA vs KK (board []) → method === 'simulated', samples <= 20000, hero.equity within ±2 of 81.9.
- [ ] Determinism: two identical calls return identical numbers (seed mulberry32(0x1234 + live.length) is fixed), so exact-value snapshots are safe.
- [ ] Flop nuts vs air: hero with top set on a dry flop vs a no-pair hand → hero.equity in a sane band (e.g. > 90) and win+tie+loss percentages sum to ~100 even when card collisions reduce total below MC.
- [ ] Turn (4 live cards) uses need === 1 runout and still produces total > 0; board with null slots is filtered by `(board || []).filter(Boolean)` — pass [c1,c2,c3,null,null] and assert it routes to the MC path, not exact.

### [P1] solverWorker message protocol

*Risk:* The UI's solving screen and results depend entirely on this envelope; a renamed field strands the user on the progress screen forever.

- [ ] Happy path: stub global self.postMessage, import solverWorker.js, invoke self.onmessage({data:{jobId:'j1', board, oopKeys, ipKeys, spot, opts:{iterations:64}}}) with a tiny 1v1 spot → posts >= 1 {jobId:'j1', type:'progress', iter, total, exploit, pct} messages followed by exactly one {jobId:'j1', type:'done', result} where result.meta exists; final progress has pct === 1 and iter === total.
- [ ] Error path: send data with spot undefined (buildTree throws on spot.betSizes) → exactly one {jobId, type:'error', message} whose message is a non-empty string, and no 'done' message.
- [ ] opts default: omit opts entirely → worker passes {} and solve still runs with the 256-iteration default (opts.iterations || 256).

### [P2] Trace/progress/meta plumbing in solve()

*Risk:* Progress cadence and meta echo are what the UI displays; cheap to test and they pin the traceEvery arithmetic.

- [ ] iterations 10 → traceEvery = max(1, floor(10/32)) = 1 → trace.length === 10; iterations 320 → traceEvery 10 → trace.length === 32 (the t === iters branch guarantees the last point).
- [ ] onProgress callback receives strictly increasing iter, pct === iter/total, and is last called with iter === iterations.
- [ ] meta echo: meta.potBb === spot.pot, meta.iterations === opts.iterations, meta.sizeCount === on-sizes + (allIn ? 1 : 0) via onSizesCount, meta.repBetPct === tree rep pct.
- [ ] pot === 0 guard is missing: exploitabilityPctPot divides by spot.pot (line 295) so meta.exploitPctPot is NaN when pot is 0 — pin the chosen fix (guard to 0 or return empty) with a test, since NumField allows 0.

### [P2] Pure helpers: rangeKey/comboCardsFor/cardsToKey/sideToRangeKeys/comboCount/actionMeta/actionColor

*Risk:* Trivial but widely imported by SolverSetup/SolverResults; a notation regression mislabels every range in the UI.

- [ ] rangeKey(0,0) === 'AA', rangeKey(0,1) === 'AKs' (r < c suited), rangeKey(1,0) === 'AKo'.
- [ ] comboCardsFor: 'AA' → 6 distinct combos, 'AKs' → 4 same-suit, 'AKo' → 12 cross-suit, no duplicate or same-card pairs.
- [ ] cardsToKey is order-insensitive and suit-aware: (Kh,Ah) → 'AKs', (Ah,Kd) → 'AKo', (Qs,Qd) → 'QQ', returns null if either card missing.
- [ ] sideToRangeKeys: {kind:'hand', cards:[one card]} → [], {kind:'hand'} with 2 cards → [cardsToKey(...)], {kind:'range', keys:[...]} → keys, null → [].
- [ ] comboCount('AA') === 6, comboCount('AKs') === 4, comboCount('AKo') === 12; combosFromKeys(['AA','AKs','AKo']) === 22; combosFromKeys(null) === 0.
- [ ] actionColor thresholds: sizePct 999 → '#7c1d18', 40 → '#e69a8f', 80 → '#d8463e', 150 → '#bb352c', 151 → '#9a2922'; kind check/call/fold/raise map to their fixed colors.

## hand replayer engine + view + share (frontend/src/replayerEngine.js, frontend/src/Replayer.jsx, frontend/src/replayShare.js)

*Currently covered:* replayerEngine.test.js covers position/blind tables, initState blind posting (incl. heads-up and antes), legalOptions preflop/postflop, raise mechanics (pot/toCall/lastRaiseSize/reopen), fold-out termination, BB option, one full 4-street buildReplay frame sequence, single-run all-in auto-runout, overbet-capped raise, and basic liveState, plus equity sanity via pokerEngine. Replayer.test.jsx only mounts ReplayerView with a 3-seat fold/call/check hand and clicks Forward once. replayShare.test.js covers the v2 round-trip (seats, cards, positions, actions, board, board2/won/runResults, cents=true), legacy v1 decode, and two malformed inputs.

### [P0] Engine: short all-in calls and short all-in raises (side-pot-relevant money math)

*Risk:* applyAction's call branch caps pay at the stack and the raise branch unconditionally resets every opponent's acted flag and overwrites lastRaiseSize with any positive increment — none of this is tested, and a regression silently corrupts pot/stack math and min-raise sizing for every imported PokerNow hand.

- [ ] Short call: 3-handed, seat 0 stack 5; seat 1 raises to 20; applyAction({seat:0,type:'call'}) → st.stacks[0]===0, st.allin[0]===true, st.streetContrib[0]===5 (not 20), st.pot increases by exactly 5, and st.toCall stays 20 for remaining players
- [ ] After a short all-in call, needsAction(st, shortSeat) is false and findNext skips that seat for the rest of the hand
- [ ] Short all-in 'raise' below min-raise: toCall=6, lastRaiseSize=4, seat with stack making target 8 (increment 2 < 4) raises all-in → assert lastRaiseSize after (current code sets it to 2 — pin whether that is intended; standard NLHE keeps 4) and assert whether players who already acted get acted reset to false (current code reopens action — pin intended behavior)
- [ ] All-in 'raise' whose capped target lands below toCall (stack only covers part of the owe): raiseIncrement<0 branch → lastRaiseSize unchanged, st.toCall unchanged (Math.max keeps old value), seat marked allin
- [ ] Raise to exactly toCall (raiseIncrement===0): lastRaiseSize unchanged and aggressor still reassigned — assert current behavior so it can't drift silently
- [ ] buildReplay with one short stack all-in and two bigger stacks continuing: committed[] per seat at the final frame equals each player's actual total contribution (the only data side-pot rendering could ever be built from)

### [P0] Engine: uncalled bet handling at fold-out

*Risk:* buildReplay/applyAction never return an uncalled bet — when everyone folds to a raise the final frame's pot includes the uncalled portion and the raiser's stack stays debited, so the displayed pot disagrees with any recorded hand.won payout; nothing pins this behavior.

- [ ] 6-max: seat 3 raises to 6, everyone folds → assert final frame pot (currently 9, includes 4 uncalled over the BB's 2) and st.stacks[3] (currently 194) — pin the intended values: if uncalled-bet return is the spec, pot should be 5 and stacks[3] 198; write the test to the spec so the current behavior fails loudly if wrong
- [ ] Bet 50 on the flop, single opponent folds → final frame handOver===true, nextSeat===null, and pot/stack assertion for the uncalled 50 (same spec decision as above)
- [ ] ReplayerView with hand.won recorded for a fold-out hand: the '+$' amount shown on the last frame equals hand.won[seat] even when frame.pot includes uncalled chips (guards the UI against the engine's pot/payout mismatch)

### [P0] Run-it-twice frames (buildRunTwiceFrames + the twice branch of the frames memo)

*Risk:* Entirely untested new code path; a regression breaks playback for every RIT hand (wrong frame counts, wrong run1Dealt/run2Dealt, wrong per-run payouts) without any test failing.

- [ ] buildReplay(setup, actions, board, /*runTwice*/ true) with a preflop all-in: last base frame boardDealt===0 and zero 'deal' frames (the !runTwice guard at the runout loop), unlike the existing single-run test that expects 3 deal frames
- [ ] ReplayerView with board2+runResults, preflop all-in heads-up: total frames = base(3) + 9 RIT frames; step counter reads '1 / 12' and End/Last lands on '12 / 12'
- [ ] RIT frame sequence for shared=0: frame fields progress run1Dealt 0→3→4→5 with run2Dealt stuck at 0 and activeRun 1, then run1 result frame (kind 'result', runResult===runResults[0]), then run2Dealt 3→4→5 with run1Dealt 5, then run2 result with runResult===runResults[1]
- [ ] All-in on the turn (base last frame boardDealt===4): steps===[5] so only 5 RIT frames are appended (intro, run1 river, run1 result, run2 river, run2 result)
- [ ] All-in on the river (boardDealt===5): steps empty → exactly 3 RIT frames (intro + two result frames), no deal frames
- [ ] On a run1 result frame, ReplaySeat shows '+$' with runResults[0].won[seat] and that seat has the 'winner' class; on the intervening run2 deal frames resultWon is null again so the '+$' chip disappears
- [ ] During twice frames the RUN 1 / RUN 2 board rows render and the run2 row has the 'pending' class while frame.activeRun < 2; equity bars are never shown (showEq excludes twice)
- [ ] frames memo: hand with board2 set but runResults null is treated as single-run (twice requires both) — auto-runout deal frames appear and no RIT frames are appended

### [P0] winners / resultWon selection (recorded payouts vs equity-at-showdown)

*Risk:* This memo decides which seat gets the winner highlight and the money chip; the epsilon tie logic and the recorded-payout precedence (idx !== last || hand.won → null) have zero tests, and a regression shows the wrong winner — the core output of the replayer.

- [ ] Single-board hand with hand.won={1:13000}: no winner highlight and no '+$' chip on any frame except the last; on the last frame seat 1 has 'winner' class and shows '+$130.00' when setup.cents is true (fmtMoney path)
- [ ] hand.won present: equity-based winner branch is skipped even at boardDealt===5 (the `|| hand.won` guard) — a seat with worse recorded payout but better equity must NOT be highlighted
- [ ] No hand.won, full 5-card board, AA vs KK with KK drawing dead: on the final frame only the AA seat gets 'winner' (best-equity branch, e > best+0.001)
- [ ] No hand.won, board plays (e.g. broadway on board, both hole cards irrelevant): both active seats highlighted via the tie branch (|e-best| < 0.001)
- [ ] Everyone folds to one player: that seat is the sole winner on the last frame even though boardDealt < 5 (active.length===1 early return)
- [ ] resultWon Object.keys(...).map(Number) survives the share round-trip where won keys become strings — decodeReplay(encodeReplay(hand)).won fed into ReplayerView still highlights seat 1

### [P0] Favorite toggle flow (toggleFavorite, savedId/favorited state)

*Risk:* Routing between onSetFavorite and onSaveToHistory is brand new and untested; a regression silently double-saves hands or strands favorites that can never be un-favorited (savedId never set).

- [ ] Fresh unsaved hand: click 'Favorite' → onSaveToHistory called exactly once with ({...hand}, summary) where summary.isReplay===true and summary.actionCount===hand.actions.length; onSetFavorite NOT called; button flips to '✓ Favorited'; toast 'Added to favorites' appears
- [ ] After onSaveToHistory resolved 'id123': clicking again calls onSetFavorite('id123', false), does NOT call onSaveToHistory again, toast 'Removed from favorites', button back to 'Favorite'
- [ ] initialHand with savedId:'abc', favorited:false: click Favorite → onSetFavorite('abc', true) and onSaveToHistory never called
- [ ] initialHand with favorited:true: button renders '✓ Favorited' on mount (state seeded from props)
- [ ] onSaveToHistory resolves null/undefined: savedId stays null, but favorited still becomes true — then unfavorite click calls neither callback (current behavior; pin it or assert the intended fix)
- [ ] Race: click Favorite twice before the onSaveToHistory promise resolves — assert onSaveToHistory is not called twice (current code double-saves because favorited only flips after await; this test should encode the intended single-save behavior)
- [ ] Click 'New hand' then complete a new hand via handleComplete: savedId resets to null and favorited to false, so favoriting the new hand calls onSaveToHistory, not onSetFavorite with the stale id
- [ ] initialHand prop changes to a different saved hand: savedId/favorited re-sync from the new prop (the useEffect on initialHand)

### [P1] Keyboard navigation + transport bounds (go clamp)

*Risk:* Untested interaction surface; the input-focus guard and the clamp in go() are the only things preventing navigation from escaping [0, frames.length-1] or hijacking typing.

- [ ] ArrowRight on window advances the frame ('Blinds posted' disappears); ArrowLeft returns to it
- [ ] ArrowLeft at idx 0 stays at frame 1 of N (go clamps to 0, no crash, step counter unchanged)
- [ ] End jumps to the last frame (step counter 'N / N') and ArrowRight there is a no-op; Home returns to '1 / N'
- [ ] With focus inside an <input> (e.g. the ShareModal URL field or any text input), ArrowRight does NOT change the frame (tagName guard for INPUT/TEXTAREA/SELECT)
- [ ] Buttons: 'First' and 'Back' have disabled attribute at idx 0; 'Forward' and 'Last' disabled at the last frame; clicking 'Last' renders the final frame's label
- [ ] Loading a new hand (initialHand change or handleComplete) resets idx to 0 even if the previous hand was parked on frame 10

### [P1] useFrameEquity / computeFrameEquity gating, caching, and display rules

*Risk:* Equity is the headline number on every seat; the unknown-cards bail-out ({}) and the sole-active short-circuit (100%) are unexercised, so a regression could show garbage equity computed from incomplete information.

- [ ] Frame where an active seat has cards:null (the test HAND's 'rex' before folding): computeFrameEquity returns {} → no .replay-seat-eq bars rendered for anyone
- [ ] After the unknown-cards seat folds, equity bars appear for the two known-card seats (await the setTimeout(0) tick with findBy*) and the percentages sum to ~100
- [ ] Frame with one non-folded seat: that seat's equity is exactly 100/win 100/tie 0 without calling PokerEngine.calculate (vi.mock pokerEngine and assert zero calls)
- [ ] Cache key: stepping between two frames on the same street with the same folded set re-uses the cache — mock PokerEngine.calculate and assert it is called once, not once per frame
- [ ] Equity is hidden when showResult (resultWon on screen) and on all frame.twice frames, even though eqPct is non-null
- [ ] PokerEngine.calculate throwing → computeFrameEquity returns {} and the view renders without crashing (try/catch branch)

### [P1] Engine init/runout edge branches

*Risk:* initState's ante-felts-a-player path, short blind posting, the partial-board runout guard, and multi-street deal catch-up are all real branches that imported hands hit; corruption here mis-stacks every frame after it.

- [ ] Ante >= stack: seat with stack 1 and ante 1 → allin at init, posts no blind, findNext skips it (st.nextSeat never that seat), pot includes only the 1
- [ ] BB with stack 1 when bb=2: postBlind posts 1, st.allin[bb]===true, but st.toCall is still 2 — other callers pay the full 2
- [ ] buildReplay all-in preflop with only a 3-card board known: runout loop deals the flop then stops (board.length >= STREET_BOARD[st.street+1] guard) — exactly 1 deal frame, boardDealt===3
- [ ] buildReplay all-in on the river (street 3): runout loop body never executes (STREET_BOARD[4] undefined → comparison false), no extra frames
- [ ] Actions that skip a street (e.g. next action has street 2 after street 0, flop checked through is absent in data): the while loop emits one 'deal' frame per intermediate street with correct streetName and boardDealt 3 then 4
- [ ] describeAction with setup.cents: 'calls' / 'bets' / 'raises to' labels divide by 100 with 2 decimals (e.g. call of 150 cents renders 'calls 1.50') — assert via buildReplay frame labels
- [ ] liveState stops applying actions after handOver (trailing actions in the array are ignored, pot unchanged)

### [P1] HandBuilder flow (setup validation, quickSizes, deal flow, undo)

*Risk:* The builder constructs the setup/actions consumed by everything else; untested validation lets an impossible hand reach buildReplay, and quickSizes math errors produce wrong bet amounts in built hands.

- [ ] 'Enter action →' is disabled until every seat has 2 cards, and the foot note reads 'N players still need cards' with correct singular/plural ('1 player still needs cards')
- [ ] changeCount from 6 to 3 preserves seat 0-2 names/stacks/cards and relabels pos to BTN/SB/BB; growing back to 6 fills new seats with default stack 100*bb
- [ ] Action phase 6-max: panel says action is on the UTG seat; clicking Fold appends {seat:3,type:'fold',street:0} (assert via the action log entry text)
- [ ] quickSizes facing a bet: with pot 3 and toCall 2 preflop, '½ pot' computes round(2 + (3+2)*0.5)=5 clamped up to minRaiseTo 4 → assert the rendered quick-button amounts; 'All-in' equals opts.maxTo
- [ ] Raise commit button is disabled while betAmt is empty or below minRaiseTo, and a typed amount above maxTo is capped to maxTo in the pushed action
- [ ] After preflop closes, 'Deal Flop (3 cards)' appears (needsDeal branch); confirming 3 cards advances the header to 'Enter action · Flop' and renders them in the board strip; turn/river deals ask for 1 card
- [ ] Undo removes the last action; undoing the only flop action does NOT step currentStreet back to preflop (the comment in undo() promises it but the code never uses `last` — write the test to the intended behavior so the latent bug surfaces)
- [ ] Hand-complete states: fold-out shows 'Everyone folded to the last player standing.', river check-through shows 'Action reached showdown.'; 'Watch replay →' calls onComplete with numeric (parseFloat) sb/bb/stacks

### [P1] replayShare codec edge branches + URL helpers

*Risk:* Decode runs on untrusted URL input; the unknown-action-code fallback, the v2-null sentinel, and the ante/cents-omitted defaults are unexercised, and a regression breaks or spoofs shared hands.

- [ ] Round-trip preserves ante (encode emits 'an' only when truthy; decode of a hand with ante:0 yields setup.ante===0 and cents:false when 'ce' omitted)
- [ ] Action with unknown type encodes via ACT_CODE[...] ?? 0 to fold; decoding a crafted v2 payload with action code 9 yields type 'fold' (ACT_TYPES[9] || 'fold')
- [ ] Bet with amount 0 round-trips as amount 0 (a.amount != null includes 0), while a call without amount decodes with no amount key
- [ ] decodeReplay('~not-lz-garbage') hits the unpackV2-null sentinel and returns null (distinct from the tested non-tilde 'garbage !!' path that falls through to v1)
- [ ] Crafted v2 payload with st:[] returns null (the r.setup.seats.length guard); payload where a seat entry is not an array returns null via the expandReplayV2 try/catch
- [ ] v1 object missing 'b' (board) returns null (the !o.s || !o.a || !o.b guard)
- [ ] 9-seat hand round-trips with positions ['BTN','SB','BB','UTG','UTG1','MP','LJ','HJ','CO'] and heads-up with ['BTN','BB'] (positionsForCount inside expandReplayV2)
- [ ] readReplayFromUrl: returns decoded hand when location.hash is '#r=<encoded>', null for empty hash and for '#other=x'; buildReplayShareUrl output starts with origin+pathname+'#r=' and decodeReplay of its suffix round-trips

### [P2] buildReplaySummary (exported, used for every saved history row)

*Risk:* Wrong hero detection or equity pick writes a corrupted summary into persisted history; it is exported and pure, so it is cheap to test.

- [ ] Hero is the lowest-index seat with 2 known cards (seat 0 cards:null, seat 1 known → heroSeat 1, heroName from seat 1 name, heroCards match)
- [ ] No seat has known cards: heroCards null, heroName null, heroEquity null, and topEquity null when equity is empty (the topEquity>=0 guard)
- [ ] topName/topEquity pick the max across the equity map using seat names, falling back to pos then 'Player N' for unnamed seats
- [ ] blindsLabel is `${sb}/${bb}`, boardPreview is at most 5 cards, actionCount equals hand.actions.length

### [P2] frames memo resilience + misc display branches

*Risk:* buildReplay throwing on malformed imported hands must degrade to an empty replayer instead of a white screen; cents pot formatting is the money display for real-currency PokerNow hands.

- [ ] Hand whose actions reference an out-of-range seat makes buildReplay throw → frames===[] and ReplayerView renders header without ReplayTable/TransportBar (frame null guards) instead of crashing
- [ ] setup.cents:true renders the pot as (pot/100).toFixed(2) — pot 350 shows '3.50'; cents:false shows fmt() whole-chip rounding ('3.5' style, max 2 decimals)
- [ ] BetChip renders nothing when streetContrib is 0 and the seat's bet amount when positive, using the cents-aware money formatter
- [ ] ALL-IN badge shows for allin && !folded seats and never for folded ones; unknown-card seats render two CardBacks

## PokerNow log import (frontend/src/pokernowImport.js parser + frontend/src/UploadModal.jsx modal)

*Currently covered:* pokernowImport.test.js (10 tests) covers: parsePokerNowLog rejection of non-JSON and non-PokerNow JSON, roster ids/names/counts and sort order, convertHandsFor filtering by dealt-in player, convertAllHands converting everything, hero-card pivoting, cents/blinds setup with normal button-on-occupied-seat ordering, board + action reconstruction for one simple hand (call/check/bet/fold), one valid:true pot reconciliation with an UNCALLED event, and skipping gameType 'plo'. UploadModal.jsx has no tests at all, and none of the parser's failure/edge branches (dead button, valid:false, run-twice, SHOW, renames, malformed events) are exercised.

### [P0] seatOrder dead-button branch

*Risk:* If the i<0 fallback in seatOrder regresses, every seat gets the wrong position label and blind assignment, silently corrupting action attribution and all downstream pot math for hands where a player left the button seat.

- [ ] Players on physical seats [0,2,5] with dealerSeat:1 (empty seat): setup.seats order is [seat0, seat2, seat5] — the occupied seat just below the dead button (seat 0) becomes BTN.
- [ ] Players on physical seats [0,2,5] with dealerSeat:4: order is [seat2, seat5, seat0], i.e. seat 2 (largest occupied seat < 4) is BTN.
- [ ] Players on physical seats [2,5] with dealerSeat:0 (dead button below all occupied seats): wrap-around branch (i = phys.length-1) makes seat 5 the BTN, order [5,2].
- [ ] 3-player hand with dealerSeat on an occupied non-zero seat (e.g. seats [0,1,2], dealerSeat:2): order [2,0,1] with labels BTN/SB/BB — guards the normal indexOf path against off-by-one when button isn't seat 0.

### [P0] Pot reconciliation and the valid flag

*Risk:* valid is the only guard against importing a mis-parsed hand whose replayed pot doesn't match PokerNow's payouts — money-math corruption is silent if it regresses.

- [ ] Hand whose WIN total disagrees with the rebuilt pot by more than 1 cent (e.g. reuse SAMPLE hand 1 but change the WIN payload value from 200 to 300): convertHandsFor still returns the hand but with valid:false.
- [ ] Off-by-exactly-1-cent: WIN value 199 instead of 200 on the SAMPLE hand → valid:true (Math.abs(last.pot - uncalledTotal - winTotal) <= 1 tolerance); WIN value 198 → valid:false.
- [ ] Missing UNCALLED event on a hand where a bet went uncalled (drop the type:16 event from SAMPLE): pot no longer reconciles, valid:false.
- [ ] ReplayEngine.buildReplay throwing (or producing NaN) is caught: a hand with an action event whose seat has no player (e.g. type:8 with seat:9) yields valid:false rather than the exception escaping convertHandsFor.
- [ ] WIN event with a seat not in the seat map (e.g. seat:99): winTotal still includes the value (affects valid) but replay.won gains no entry for it — asserts the `if (idx != null)` guard.

### [P0] Run-it-twice reconstruction and reconciliation

*Risk:* board2 assembly, the per-board boardResult winner math, and the accept/reject reconciliation are completely untested; a regression splits real pots to the wrong players in imported hands.

- [ ] DEAL events with run:2 build board2 sharing earlier run-1 streets: run-1 deals flop+turn+river, run:2 re-deals only the river (turn:3) → replay.board2 = run1 flop + run1 turn + run2 river, and summary.runTwice is true.
- [ ] Accepted runResults: two players all-in preflop with known hole cards, both boards 5 cards, WIN events paying each player exactly half the pot where each wins one board → replay.runResults = [{run:1, won:{winnerSeat: half}}, {run:2, won:{otherSeat: half}}] and valid:true.
- [ ] Same-winner-both-boards: hole cards such that the same seat wins both runouts, single WIN event for the full pot → runResults present with that seat winning half on each run entry.
- [ ] Rejected runResults: identical setup but WIN events crediting the wrong player (per-seat mismatch > 2 cents vs the computed boardResult split) → replay.runResults is null while board2 and summary.runTwice:true are still present.
- [ ] Tie on one board: hole cards that chop run 1 (identical best-five) → that run's won map gives each contender Math.round(winTotal/2/2), asserting boardResult's tie-split path (s === best pushes to winners).
- [ ] Contender gating: run-twice hand where one all-in player's hole cards are unknown (no players[].hand, no SHOW) → contenders < 2, runResults stays null.
- [ ] Short board2 gating: run-twice hand that never reaches the river (board.length 4) → board2 is built but runResults is null because the board.length===5 && board2.length===5 condition fails.
- [ ] Folded players excluded from contenders: a third player with known cards who folded pre-all-in does not appear in either run's won map (last.folded[i] check).

### [P1] SHOW event hole-card reveals

*Risk:* Showdown reveals are how opponent cards become visible in imported hands; the precedence and null-guards have no tests.

- [ ] A player with no players[].hand but a type:12 SHOW event with cards ['Qh','Qs'] gets setup.seats[i].cards = [{v:'Q',s:'h'},{v:'Q',s:'s'}].
- [ ] SHOW does not overwrite players[].hand: player has hand ['As','Kd'] and a SHOW event with different cards → seats cards remain As Kd (the !cardsBySeat.has(p.seat) guard).
- [ ] SHOW with cards: [null, 'Qs'] or a non-array cards payload is ignored — the seat's cards stay null and convertHand does not throw.
- [ ] Hero whose cards come only from a SHOW event still gets summary.heroCards populated (cardsBySeat lookup happens after the SHOW pass).

### [P1] rosterFromHands rename and dedupe edges

*Risk:* Wrong most-used-name resolution or double counting misleads the user at the player-picker step and inflates hand counts.

- [ ] Same id appearing as name 'bob' in two hands and 'bobby' in one → roster entry has name 'bob' and count 3.
- [ ] Player whose name is empty/whitespace in every hand → roster name 'Unknown' (trimmed-empty names never enter the names Map).
- [ ] Duplicate player objects with the same id inside one hand's players array count once for that hand (the per-hand seen Set).
- [ ] Hands with players.length < 2 and non-th hands contribute nothing to roster counts even when the player id appears in them.
- [ ] Tie on count sorts by name localeCompare: two players each in 1 hand named 'zed' and 'amy' → roster order amy, zed.

### [P1] Action classification (CALL/BET_RAISE by value vs streetBet)

*Risk:* Types 7/8 are reclassified by committed value vs streetBet; only the postflop 'bet' and preflop 'call' branches are tested, so a regression could mislabel raises as calls and break pot reconciliation everywhere.

- [ ] Preflop open to 300 over bb 100 (value > streetBet, streetBet > 0) → action {type:'raise', amount:300}, and a subsequent call of 300 → {type:'call', amount:300} (streetBet updated to 300).
- [ ] Postflop raise: bet 150 then type:7 event with value 450 → second action is {type:'raise', amount:450} despite the event being a 'call' type code.
- [ ] Limp preflop: type:8 event with value exactly 100 (== bb) → classified 'call', not 'raise' (strict > comparison).
- [ ] streetBet resets on each run-1 DEAL: after the flop deal, a wager of 50 (< previous street's 300) is classified 'bet' because streetBet was zeroed.
- [ ] POST_SB/POST_BB events (types 3/2) produce no entries in replay.actions (engine posts blinds).

### [P1] Malformed input resilience in convertHand/convertHandsFor

*Risk:* Real exports contain partial hands; one bad hand must not abort the whole import or crash the modal.

- [ ] A hand missing its events array (h.events undefined) throws inside convertHand and is skipped by convertHandsFor's try/catch while the other hands in the log still convert.
- [ ] convertHand returns null for a 1-player hand and for gameType !== 'th', so convertAllHands output excludes them without erroring.
- [ ] Hand with NO gameType field is treated as Hold'em: included in roster counts, convertHandsFor output, and UploadModal's totalHands (the !h.gameType branch).
- [ ] DEAL event with missing/non-array cards payload is ignored (board unchanged, no throw).
- [ ] Unknown event type codes (e.g. type: 99) fall through the default case without affecting actions, board, or pot totals.
- [ ] players[].hand of ["As", null] is not used as hole cards (the p.hand[0] && p.hand[1] truthy guard) — seat cards are null.
- [ ] h.number as a numeric string parses via parseInt ('042' → 42); summary.stakes formats cents via money(): sb 50 / bb 100 → '$0.5/$1'.

### [P1] UploadModal: file intake (drop phase)

*Risk:* The modal is the only entry point for imports and has zero tests; bad-file handling regressions would let unparseable or oversized files through or strand the user without feedback.

- [ ] Selecting a file named 'log.txt' via the hidden input shows the error "That's a .TXT file — PokerNow exports are .json..." and remains in the drop phase (DropZone still rendered).
- [ ] A .json file with size 10*1024*1024 + 1 shows the "unexpectedly large" error without ever being read (FileReader not invoked).
- [ ] A .json file containing 'not json' shows the NOT_JSON message ("couldn't read that file as JSON"); one containing '{"foo":1}' shows the NOT_POKERNOW message ("doesn't look like a PokerNow log") — the two errors are distinct.
- [ ] A file with name lacking .json but file.type 'application/json' is accepted (the type fallback in isJson).
- [ ] A valid log whose hands are all non-th or <2 players renders the 'empty' phase ("No hands found in this file") with the file name, and clicking 'Choose another file' resets back to the drop phase.
- [ ] A valid log advances to the player phase: each roster row shows name and hand count, the exportHeroId row shows the 'you' badge, and the 'All hands' row count equals only th hands with >=2 players (totalHands filter).

### [P1] UploadModal: player select and ALL_PLAYERS sentinel

*Risk:* Picking the wrong conversion path (convertAllHands vs convertHandsFor) silently imports hands pivoted around the wrong hero.

- [ ] Clicking a player row calls convertHandsFor semantics: hand list shows only hands that player was dealt into, header shows '<name> · N hands' with the '#min–#max' range.
- [ ] Clicking 'All hands' (ALL_PLAYERS sentinel) lists every convertible hand pivoted on parsed.exportHeroId, header reads 'All players'.
- [ ] In ALL mode, a hand the exporter wasn't dealt into still appears, and entering a number not in the log shows the error variant "...not in this log" (vs "...not in <name>'s hands" in player mode).
- [ ] 'Change' (backToPlayers) returns to the player phase and clears selected, inputValue, and entryError.

### [P1] UploadModal: hand selection, chip input, MAX_HANDS cap, select-all, confirm

*Risk:* Cap enforcement and the selection-to-hand mapping are what actually gets imported; a regression imports the wrong hands or more than 50.

- [ ] Typing '183, 80' then Enter adds chips #183 and #80 in entry order (assuming both exist); typing a duplicate number is silently skipped (working.includes guard).
- [ ] Entering a number with no matching hand (e.g. '99') shows 'Hand #99 not in ...' and adds nothing; entering '99 100' where only 100 exists adds #100 and still shows the not-found error for #99.
- [ ] The text input's onChange strips characters outside [0-9, space] (typing 'abc12;3' leaves '123' minus stripped chars); blur with pending text commits it via processInput; the ',' key also commits (preventDefault path).
- [ ] Backspace with an empty input removes the most recently added chip; clicking a chip's × removes exactly that number.
- [ ] With a 51-hand log: 'Select all' selects only 50, the entryError reads 'Added the 50 most recent of 51 hands (max 50).', and the selected numbers are the 50 highest hand numbers displayed ascending (sort desc → slice(0,50) → sort asc).
- [ ] With ≤50 hands, 'Select all' selects every hand with no error; 'Clear' empties the selection.
- [ ] At the cap: clicking an unselected HandRow shows 'You can add up to 50 hands.' and selection stays at 50; clicking an already-selected row still deselects it; the chip input is disabled with placeholder 'Maximum 50 reached'; unselected rows render with opacity 0.45.
- [ ] processInput hitting the cap mid-batch (49 selected, paste '7 8 9') adds only one, sets capHit error, and does not validate the remaining tokens.
- [ ] Import button: disabled at 0 selected; clicking with [#80, #183] selected calls onConfirm with the matching hand objects in selection order (byNum mapping), and numbers with no hand object are filtered out.
- [ ] Reopening the modal (open false → true) resets all state: drop phase, no fileName, no selection (the useEffect [open] reset).
- [ ] Clicking the overlay backdrop calls onClose; clicking inside the dialog does not (e.target === e.currentTarget guard).

### [P2] Parser hardening odds-and-ends

*Risk:* Low-risk edges that round out the suite; failures degrade UX rather than corrupt data.

- [ ] parsePokerNowLog with no playerId field returns exportHeroId null and the player phase still renders without a 'you' badge.
- [ ] convertAllHands with a pivotId not seated in a hand yields summary.heroCards null and summary.players listed purely in button order (no hero-first pivot).
- [ ] summary.potLabel is null when there are no WIN events and '$2 pot' style otherwise; summary.runTwice false on normal hands.
- [ ] boardResult odd-cent rounding: 3-way tie scenario where Math.round(amount/3) per winner is asserted (documents that shares may not sum exactly to amount).
- [ ] Ante support: h.ante flows into setup.ante and a hand with antes still reconciles valid:true (antes enter the engine pot).
- [ ] DropZone keyboard access: Enter/Space on the focused dropzone opens the file picker (fileInputRef.click).

## share links, scenario codec, range notation/pickers (frontend/src/scenario.js, frontend/src/shareCodec.js, frontend/src/Pickers.jsx)

*Currently covered:* scenario.test.js covers happy-path v2 round-trips (two hands + board + pot/call + names, one range player, 9-seat padding from seat 0, an all-empty table), two malformed strings ('not valid !!!', ''), one fixed legacy-v1 fixture, and a length<120 guard for a single full 169-hand range. rangeNotation.test.js covers expandNotation for '44+', 'A2s+', 'A4s-A5s', comma union, and exact 'QQ'. Nothing tests shareCodec.js directly (rangeToMask/maskToRange/unpackV2), readScenarioFromUrl/buildShareUrl, topRangeByPercent/comboCount/HAND_RANKING, or the RangePicker/CardPicker components (grep confirms no test file references them).

### [P0] rangeToMask/maskToRange bitmask correctness (shareCodec.js)

*Risk:* The 169-bit mask is the v2 wire format for ranges; an off-by-one in keyToIndex/cellKey or drift between shareCodec's RANKS table and Pickers' RANK_ORDER silently swaps hands in every shared link.

- [ ] maskToRange(rangeToMask(['22'])) === ['22'] — exercises the last bit (index 168, byte 21 bit 0)
- [ ] maskToRange(rangeToMask(['AA'])) === ['AA'] — first bit (index 0)
- [ ] round-trip ['A2s'] returns exactly ['A2s'] and round-trip ['A2o'] returns exactly ['A2o'] — top-row/left-column boundary cells (indices 12 and 156) must not cross between suited and offsuit
- [ ] round-trip ['32s'] and ['32o'] independently (bottom-corner boundary cells, indices 155 and 167)
- [ ] for every (r,c) in 0..12 x 0..12: maskToRange(rangeToMask([rangeKey(r,c)])) === [rangeKey(r,c)] using rangeKey imported from Pickers.jsx — locks the duplicated rank tables in shareCodec.cellKey and Pickers.rangeKey together
- [ ] round-trip a 168-of-169 range (all keys except '22') returns exactly the input set — no neighboring-bit bleed
- [ ] rangeToMask silently drops invalid keys: rangeToMask(['ZZ','A2s']) round-trips to ['A2s'] only (keyToIndex yields NaN, the i>=0 && i<169 guard skips it) and does not throw
- [ ] rangeToMask output contains only URL-safe chars (matches /^[A-Za-z0-9_-]*$/, no '+', '/', '=')

### [P0] hostile/truncated share-string handling in decodeScenario (scenario.js + shareCodec.js)

*Risk:* decodeScenario runs on the untrusted URL hash at app load; any uncaught throw (e.g. atob inside maskToRange via b64ToBytes, which has no try/catch) crashes the app for anyone clicking a crafted or mangled link.

- [ ] truncation property: for a valid v2 string enc = encodeScenario(fullScenario), for every prefix enc.slice(0, k) with k = 1..enc.length-1, decodeScenario(prefix) does not throw and returns either null or an object with a 9-length players array
- [ ] decodeScenario('~') === null (empty payload after the V2 sigil)
- [ ] decodeScenario('~!!!not-lz!!!') === null and does not throw (decompress garbage -> null or junk -> JSON.parse catch)
- [ ] decodeScenario(packV2('just a string')) and decodeScenario(packV2(42)) do not throw (expandScenarioV2 on a non-object: o.p is undefined, returns an empty 9-seat scenario) — pin whichever behavior is intended, currently a scenario of 9 nulls
- [ ] decodeScenario(packV2(null)) === null (unpackV2 parses 'null' -> returns null -> decodeScenario null branch)
- [ ] decodeScenario(packV2({p:['***invalid base64***'],b:[]})) === null and does not throw — the string player hits maskToRange -> b64ToBytes -> atob which throws on '*', must be swallowed by the try/catch in decodeScenario's expandScenarioV2 call
- [ ] decodeScenario(packV2({p:{a:1},b:'x',n:5})) === null and does not throw (non-array p -> .map TypeError caught)
- [ ] v2 payload with out-of-range card ids: decodeScenario(packV2({p:[[999,-3]],b:[700]})) does not throw — currently yields cards with undefined v/s via idToCard; assert decode either rejects (null) or the test pins the current lenient behavior so a future validation change is deliberate
- [ ] v1 fall-through hostility: decodeScenario(btoa(JSON.stringify({p:5,b:9}))) === null and does not throw (non-array p caught by decodeScenarioV1's try/catch)
- [ ] unknown version sigil: decodeScenario('!AAAA') === null (not '~', not valid v1 base64 JSON)
- [ ] decodeScenario of a string of 10k random unicode chars does not throw (fuzz loop with seeded RNG)

### [P0] encode/decode round-trip completeness (scenario.js)

*Risk:* Untested seat-layout and string-content branches (mid-table nulls, trailing trim, unicode names, empty ranges) can silently drop or shift players in shared scenarios.

- [ ] 9 full seats round-trip: players = 5 hands + 4 range players in seats 0..8 with distinct names; decode returns all 9 in the same seats with identical hands/ranges
- [ ] mid-table empty seats survive: players = [null, hand('As','Ah'), null, {kind:'range',range:['AA']}, null, null, null, null, null] round-trips with players[0]===null, players[1] the hand, players[2]===null, players[3] the range (only trailing 0s are popped by the while loop in encodeScenario)
- [ ] trailing-trim correctness: players = [hand, null, null] encodes the same string as players = [hand] (trailing zeros trimmed), and both decode to identical 9-seat results
- [ ] unicode names round-trip: playerNames = ['Pierré', '龍さん', '🃏joker🃏'] decode back byte-identical through the lz-string envelope
- [ ] sparse names: playerNames = [null, 'Bob'] round-trips to [null, 'Bob', null, ...] — leading empty name preserved as null, decode maps '' -> null via (x || null)
- [ ] empty-range player pins: {kind:'range', range:[]} round-trips as {kind:'range', range:[]} (the all-zero mask string is truthy so it is NOT trimmed to a null seat) — pin so a refactor doesn't silently convert it to an empty seat or vice versa
- [ ] full 5-card board round-trips in order (existing tests only use 3 cards)
- [ ] property test (seeded loop, ~200 iterations): random scenario with 0-9 seats, each seat null/random-2-card-hand/random range of 0-169 keys, random 0/3/4/5 board avoiding duplicates, random unicode names, random pot/callAmt strings — decodeScenario(encodeScenario(x)) reproduces every field

### [P1] version envelope: v1 legacy decoding breadth (scenario.js decodeScenarioV1)

*Risk:* Old links in the wild must keep working; only one v1 fixture is tested and the v1-specific branches (numeric 0 seats, unicode via escape/decodeURIComponent, missing fields) are uncovered.

- [ ] v1 fixture with an empty seat: base64 of {p:[0,['h','AsAh']],b:'',...} decodes to players[0]===null and players[1] the hand (the !pl || pl === 0 branch)
- [ ] v1 fixture with unicode names: base64(unescape-encoded) of {n:['Pierré','龍']} decodes names correctly (exercises decodeURIComponent(escape(atob(s))))
- [ ] v1 fixture with missing optional fields {p:[['h','AsAh']]} (no b, n, po, ca) decodes with board [], names all null, pot '' and callAmt ''
- [ ] v1 fixture using URL-safe base64 chars ('-' and '_') and stripped padding decodes (the replace + pad-to-%4 loop)
- [ ] v1 odd-length hand string {p:[['h','AsA']]} does not throw — pins that the 2-char stride loop yields a card with s undefined rather than crashing
- [ ] decoded v1 scenario re-encodes via encodeScenario to a '~'-prefixed v2 string that decodes back identically (migration path, mirrors the replayShare.test.js pattern)

### [P1] expandNotation uncovered branches (Pickers.jsx)

*Risk:* The offsuit-plus, pair-dash, and boundary branches feed every RFI preset; a regression silently changes preset ranges and therefore every equity number computed from them.

- [ ] expandNotation('ATo+') sorted equals ['AJo','AKo','AQo','ATo'] and contains no suited keys (the offsuit i > RIDX[hi] loop)
- [ ] expandNotation('K9s+') equals {K9s,KTs,KJs,KQs} and does NOT contain 'AKs' or 'KAs' (strict i > RIDX[hi] bound)
- [ ] expandNotation('55-99') equals {55,66,77,88,99} (pair dash branch, a[0]===a[1])
- [ ] expandNotation('99-55') equals expandNotation('55-99') (Math.min/Math.max makes reversed bounds equivalent)
- [ ] expandNotation('A5s-A4s') equals expandNotation('A4s-A5s') (reversed suited dash bounds)
- [ ] expandNotation('AA+') === ['AA'] (pair-plus at the top boundary, loop runs once at i=0)
- [ ] expandNotation('22+') has length 13 (every pair)
- [ ] expandNotation('') === [] and expandNotation(' , ,') === [] (blank tokens return [] from expandToken)
- [ ] expandNotation('55 - 99') handles spaces around the dash — currently split('-').map(trim); pin it
- [ ] duplicate tokens dedupe: expandNotation('AA, AA, KK+') has 'AA' exactly once (Set semantics)

### [P1] RFI preset notation validity (Pickers.jsx POS_6MAX / POS_9MAX)

*Risk:* PRESET_GROUPS is built from 13 long hand-typed notation strings at module load; a single typo produces garbage keys (e.g. expandNotation('AK') yields the string 'AKundefined') that render nothing in the grid and get silently dropped by rangeToMask when shared.

- [ ] build the set of all 169 valid keys via rangeKey(r,c); for each of the 5 POS_6MAX and 8 POS_9MAX notation strings, every key from expandNotation(notation) is a member of that set
- [ ] each preset expands to a non-empty range, and combo totals are sane: Button/SB presets expand to more combos than UTG within the same table size
- [ ] no preset key ends with 'undefined' and every key matches /^([AKQJT98765432]{2}|[AKQJT98765432]{2}[so])$/

### [P1] topRangeByPercent / comboCount / HAND_RANKING (Pickers.jsx)

*Risk:* The 'Top X%' slider is a user-facing math claim; off-by-one in the combo accumulation or a ranking regression mislabels what range a user is actually running equity against. Note: these are module-private — export them (or test via the RangePicker slider) first.

- [ ] topRangeByPercent(0) === [] and topRangeByPercent(-5) === [] (pct <= 0 guard)
- [ ] topRangeByPercent(100) returns all 169 keys (target 1326 reached exactly at the final key)
- [ ] topRangeByPercent(0.1) === ['AA'] (target 1.326, first key alone with 6 combos satisfies combos >= target)
- [ ] topRangeByPercent(0.5) === ['AA','KK'] (target 6.63: AA's 6 combos < 6.63, adding KK crosses it) — pins both the boundary arithmetic and that AA, KK head HAND_RANKING
- [ ] monotone-subset property: for pct pairs (1,5), (5,20), (20,60), (60,100), topRangeByPercent(lo) is a subset of topRangeByPercent(hi)
- [ ] minimality: for pct in {1, 5, 25, 50}, sum of comboCount over the result is >= pct/100*1326, and dropping the last key falls below the target
- [ ] comboCount: 6 for 'AA', 4 for 'AKs', 12 for 'AKo'; sum of comboCount over all 169 rangeKey cells === 1326
- [ ] HAND_RANKING has 169 unique entries; index of 'AA' < 'KK' < 'QQ', and index of 'AKs' < index of 'AKo' (the +20 suited bonus)

### [P1] URL building/reading and length regression (scenario.js)

*Risk:* Share links that exceed browser/messenger URL limits get truncated in transit and decode to null, losing user setups; readScenarioFromUrl is the only entry point from a real link and is untested.

- [ ] worst-case length guard: encodeScenario with 9 seats all holding the full 169-hand range, 5-card board, nine 20-char unicode names, pot/callAmt strings — buildShareUrl result length < 2000 (and record the current actual length as a tighter snapshot, e.g. < 600, so growth is visible in review)
- [ ] buildShareUrl output equals window.location.origin + pathname + '#s=' + encodeScenario(x), and the fragment after '#s=' decodes back to the input
- [ ] readScenarioFromUrl returns the decoded scenario when window.location.hash = '#s=' + enc (set via jsdom)
- [ ] readScenarioFromUrl returns null for hash '' and for unrelated hashes like '#r=abc' or '#share' (startsWith('#s=') guard)
- [ ] readScenarioFromUrl with hash '#s=garbage' returns null without throwing

### [P2] RangePicker component behavior (Pickers.jsx, RTL)

*Risk:* Save/Clear/slider/preset wiring determines which range actually reaches the equity engine; zero component coverage today.

- [ ] renders with initial=['AA','AKs'] showing '10 combos' (6+4) and '0.8%' in .picker-sub
- [ ] 'Save range' is disabled when keys is empty and enabled after a cell is selected; clicking it calls onSave with exactly the selected keys array
- [ ] Clear empties the selection and disables Save
- [ ] mouseDown on the 'AA' cell toggles it on; a second mouseDown toggles it off (the !active -> 'on'/'off' dragMode branch)
- [ ] drag-select: mouseDown on 'AA' then mouseEnter 'KK' while dragging selects both; mouseup on window resets so a later mouseEnter does not extend the selection
- [ ] changing the slider to '100' selects all 169 cells and the label shows '100.0%'; changing to '0' clears to 0 combos
- [ ] opening the Preset menu and clicking '6-max opening ranges > UTG' replaces the selection with expandNotation of the UTG string; clicking outside (mousedown on document) closes the menu
- [ ] Cancel calls onCancel without calling onSave

### [P2] CardPicker component behavior (Pickers.jsx, RTL)

*Risk:* The used/selected gating prevents duplicate cards across seats and board; a regression lets the same physical card into two hands, corrupting every equity result built from the picked cards.

- [ ] a card present in usedCards but not selected renders disabled with class 'used'; clicking it does not call onPick
- [ ] a card present in BOTH usedCards and selected is NOT disabled (isUsed = usedSet.has(id) && !selSet.has(id)) — pins the deselect-your-own-card affordance
- [ ] Confirm is disabled while selected.length !== maxCards and enabled at exactly maxCards (test maxCards=2 with 1 then 2 selections)
- [ ] clicking the 'As' button calls onPick({v:'A', s:'s'}) and the button has aria-label 'A of s'
- [ ] the 'T' rank renders as '10' with the is-ten class
- [ ] header shows 'N / maxCards selected' and the selected tray renders PlayingCard for filled slots, EmptyCardSlot otherwise
- [ ] Clear and Cancel call onClear and onClose respectively

### [P2] malformed range-key hardening across modules (Pickers.jsx + shareCodec.js)

*Risk:* keyToIndex('AK') (length-2 non-pair) takes the pair branch and maps to index 0 = AA, so a malformed key silently becomes pocket aces in a shared link; cheap tests pin or motivate a guard.

- [ ] rangeToMask(['AK']) currently sets the AA bit: maskToRange(rangeToMask(['AK'])) === ['AA'] — pin this as a documented quirk or change keyToIndex to reject non-pair 2-char keys and assert [] instead
- [ ] expandNotation('AK') returns ['AKundefined'] today (suit char missing); decide and pin: either it stays passthrough-garbage or the token is rejected to []
- [ ] rangeToMask(['A2x']) (third char not 's') maps via the offsuit else-branch to 'A2o' — pin or reject
- [ ] maskToRange('') === [] (zero-length byte array, undefined & bit yields 0) and maskToRange of a 1-byte mask 'AQ' does not throw despite being shorter than 22 bytes
- [ ] encodeScenario with pot=0 (number) round-trips as '' (the pot || '' coercion) while pot='0' (string) survives — pin so numeric callers learn the contract

## frontend UI components & app shell

*Currently covered:* App.test.jsx has 2 tests: toolbar buttons render (Clear all / Replayer / Upload log) and pot odds = 25.0% for pot=100/call=50 in the default potOdds tab. Replayer.test.jsx has 2 tests on ReplayerView frame rendering/advance. Pure-logic suites exist (pokerEngine, replayerEngine, scenario, replayShare, pokernowImport, rangeNotation, equity) but no test touches HistoryDrawer, AuthContext, UserChip, ShareModal, Seat, Cards, or any Solver component, and vitest.setup.js stubs only ResizeObserver — there is no Worker mock, so the equity-worker and solver-worker paths are entirely unexercised.

### [P0] MDF tab + pot-odds panel math (ResultsPanel in App.jsx)

*Risk:* potOddsPct = call/(pot+2*call) and mdfPct = pot/(pot+call) are user-facing money math; the MDF branch has zero coverage and a silent formula swap would corrupt every displayed threshold.

- [ ] Clicking the 'MDF' toggle button switches the panel heading from 'Pot Odds' to 'MDF' and relabels the inputs to 'Pot (before bet)' and 'Bet' (potOdds mode shows 'Pot' / 'To call').
- [ ] In MDF mode with pot=100, bet=50, the MDF row shows '66.7%' (pot/(pot+call)*100) and the 'Bet : pot' row renders '50 into 100'.
- [ ] MDF row shows 'N/A' when either input is empty or 0 — potOddsEntered requires potNum > 0 && callNum > 0.
- [ ] In potOdds mode the 'Risk : reward' row shows callAmt 'to win' pot+call (50 to win 150 for 100/50).
- [ ] Non-numeric or negative input ('abc', '-50') yields 'N/A' in both modes (parseFloat||0 then >0 guard).
- [ ] Toggling MDF -> Pot Odds preserves the entered pot/call values and re-shows '25.0%'.
- [ ] results-meta header shows 'min defense frequency: X%' only when oddsMode==='mdf' AND results.perPlayer is non-empty (haveResults); with no equity results it renders an empty string.
- [ ] With mocked equity results and oddsMode==='potOdds', a player row whose equity >= potOddsPct gets class eq-row-pos and one below gets eq-row-neg; switching to MDF makes all rows eq-row-neutral (useColor only in potOdds mode).

### [P0] Optimistic history CRUD with rollback (toggleFavorite / deleteHistoryItem / clearAllUnfavorited in App.jsx)

*Risk:* These mutate the user's saved-hands list optimistically; a regression in the rollback branches silently shows state that diverges from the database.

- [ ] toggleFavorite(id, true): star fills immediately (before fetch resolves) and a PATCH to /api/searches/{id} is sent with body {"favorite":true} and credentials:'include'.
- [ ] toggleFavorite rollback: when the PATCH resolves ok:false, the item's starred flag reverts to its previous value (catch flips back to !favorite).
- [ ] toggleFavorite rollback also fires when fetch rejects (network error).
- [ ] deleteHistoryItem: row disappears immediately and DELETE /api/searches/{id} is issued; on ok:false or rejection the full previous history array is restored (setHistory(prev)).
- [ ] clearAllUnfavorited: removes only items with starred===false from state, issues one DELETE per unfavorited id, leaves starred rows untouched, and (pin current behavior) does NOT roll back if an individual DELETE fails.
- [ ] loadHistoryItem fires touchHistoryItem: PATCH /api/searches/{id} with body {"touch":true}; touchHistoryItem no-ops when user is null or id is falsy (no fetch issued).
- [ ] loadHistoryItem on a replay row (isReplay && replay) switches view to 'replayer' and closes the drawer without calling decodeScenario; on a scenario row it loads players/board/pot/callAmt into the calculator and sets view 'calc'.

### [P0] SolverView worker lifecycle, jobId staleness guard, stage machine (SolverView.jsx)

*Risk:* If the jobId guard (m.jobId !== jobRef.current) or the done/error branches regress, stale or failed solves silently overwrite the results screen with wrong strategy numbers.

- [ ] Stub global.Worker with a class capturing instances (postMessage spy, settable onmessage, terminate spy) — mounting SolverView constructs exactly one Worker; unmounting calls terminate() and nulls workerRef.
- [ ] runSolve (click enabled Solve): posts {jobId:1, board, oopKeys, ipKeys, spot, opts:{oopRestrict, ipRestrict}} to the worker and switches stage to 'solving' (SolvingView text 'Running CFR iterations' visible, SetupView gone).
- [ ] restrictFor: when oopSide = {kind:'hand', cards:[Ah,Kh]}, the posted opts.oopRestrict is a Set containing both orderings 'AhKh'+'KhAh' (a.v+a.s+b.v+b.s and reverse); for a range side it is null.
- [ ] Simulated message {jobId:1, type:'progress', iter:128, total:256, exploit:1.5, pct:0.5} updates the solving screen: '50%' and '128' iterations rendered.
- [ ] Message {jobId:1, type:'done', result:<fixture>} switches stage to 'results' and renders ResultsView.
- [ ] Message {jobId:1, type:'done', result:{empty:true}} shows the banner 'No live combos to solve — check the board and ranges.' and returns to SetupView (stage 'setup').
- [ ] Message {jobId:1, type:'error', message:'boom'} shows 'boom' in .sv-error-banner and returns to setup; a subsequent runSolve clears the banner (setError(null)).
- [ ] Staleness: after Re-solve bumps jobRef to 2, a late {jobId:1, type:'done', result} or progress message is ignored — stage and progress state unchanged.
- [ ] runSolve resets progress to {iter:0,total:256,exploit:0,pct:0} and result to null before posting (no flash of old results).

### [P0] Solve button ready-gating (SetupView in SolverSetup.jsx)

*Risk:* ready = boardComplete && hasHolding(oopSide) && hasHolding(ipSide); if gating regresses a solve runs on an incomplete river spot and produces garbage output.

- [ ] Render SetupView (exported) with default props: Solve button disabled and warn text 'Set all 5 board cards to solve.' shown while board has any null.
- [ ] With a full 5-card board but both sides {kind:'unset'}: still disabled, warn switches to 'Set a hand or range for both players.'
- [ ] A side of {kind:'hand', cards:[one card]} does NOT satisfy hasHolding (filter(Boolean).length === 2 required) — Solve stays disabled.
- [ ] A side of {kind:'range', keys:['AA']} satisfies hasHolding; with full board and both sides set, Solve is enabled and clicking it calls onSolve exactly once; the warn line is not rendered.
- [ ] The board 'Clear all' button resets all five slots to null and re-disables Solve.
- [ ] Tree summary shows 'SPR 4.0' for pot=20/stack=80 and em-dash '—' when spot.pot is 0/'' (spot.pot truthiness guard); sizeCount = betSizes.length + (allIn ? 1 : 0) reflected in 'N bet sizes'.

### [P0] SolverResults grid layouts, drill-in, heat focus fallback (SolverResults.jsx)

*Risk:* This screen is the solver's entire output; a rendering regression (wrong agg widths, wrong dominant color, stale focusAction) silently misreports strategy frequencies.

- [ ] Build a fixture Solve object: result = {nodes:[{id:'oop_first',actor:'OOP',label:'OOP — first to act',actions:[{id:'check',kind:'check',label:'Check'},{id:'b75',kind:'bet',sizePct:75,label:'Bet 75%'}]},{id:'ip_vs_check',actor:'IP',label:'IP — vs check',actions:[{id:'check',...},{id:'b33',kind:'bet',sizePct:33,label:'Bet 33%'}]}], nodeSolves:{oop_first:{byKey:{AA:{hkey:'AA',agg:{check:0.6,b75:0.4},dominant:'check',count:6,combos:[{id:'AsAh',cards:[As,Ah],cat:1,weights:{check:0.6,b75:0.4}}]}},combos:[...],count:6}, ip_vs_check:{...}}, meta:{evOOP:10.123,evIP:9.877,exploitPctPot:0.42,iterations:256,sizeCount:4,potBb:20}, trace:[5,3,1,0.4]}.
- [ ] Header stats render meta values formatted: 'EV · OOP' 10.12, 'EV · IP' 9.88, exploitability '0.42' with '% pot' unit, '256 iters' next to the sparkline.
- [ ] One node tab per result.nodes with the actor badge (oop/ip class); label strips the leading 'OOP — '/'IP — ' prefix via the regex; clicking a tab switches the grid to that node's nodeSolve.
- [ ] Strategy layout: the AA cell renders fill divs with width '60%' (check color) and '40%' (b75 color); an action with agg weight < 0.01 renders no div.
- [ ] Dominant layout: the AA cell gets background actionColor(check) and opacity 0.32 + 0.68*0.6.
- [ ] Heat layout: the action picker appears listing the node's actions; default activeFocus is the first kind==='bet' action (focusDefault), and cell opacity is 0.06 + 0.94*agg[focus].
- [ ] Heat focus fallback: select focusAction 'b75' on oop_first, then switch to ip_vs_check (which has no 'b75') — activeFocus falls back to that node's own default ('b33' highlighted), no crash, no all-zero grid.
- [ ] Clicking the AA cell shows ComboDetail drill-in: 'AA' + '6 combos', per-combo row with CardChips, CAT_NAME[1]==='Pair', and a SegBar; clicking the same cell again toggles back to 'Range summary'.
- [ ] Switching node clears the selection (useEffect on nodeId sets selectedKey null) — drill-in returns to 'Range summary'.
- [ ] A key absent from solve.byKey renders a non-interactive div.sv-cell.empty (no onSelect).
- [ ] Range summary aggregate weights are count-weighted means across byKey (agg[aid]*count summed / total count).
- [ ] 'Edit spot' calls onBackToSetup and 'Re-solve' calls onResolve; Sparkline with trace.length < 2 renders an empty svg without throwing.

### [P1] Auto-save commitToHistory snapshot + page-exit beacon (App.jsx)

*Risk:* The dedupe (snap.scenario === lastSavedScenarioRef) and beacon path are the only thing standing between one history row per hand and either duplicate rows or silently lost hands.

- [ ] Prereq: stub global.Worker (jsdom has none) so setting a player hand doesn't throw in the equity effect; drive a fake 'batch' message ({jobId:<matching calcVersion>, type:'batch', deltaValid, deltaWins, deltaTies}) so results.sims > 0 and currentSnapshotRef is populated.
- [ ] With no snapshot (no active players / sims===0), clearAll() issues no POST to /api/searches.
- [ ] With a populated snapshot and a signed-in user, clearAll() POSTs once to /api/searches with {name:null, players, board, playerNames, scenario, odds} and keepalive:true.
- [ ] Dedupe: a second boundary (e.g. dealRandom right after) without edits does not POST again because snap.scenario === lastSavedScenarioRef.current.
- [ ] Failed commit POST resets lastSavedScenarioRef to null so the next boundary retries the save.
- [ ] pagehide event (and visibilitychange to 'hidden') calls commitToHistory(true) which uses navigator.sendBeacon('/api/searches', Blob) instead of fetch when sendBeacon exists; visibilityState 'visible' does not trigger it.
- [ ] Signed out: commitToHistory is a no-op (early return, no fetch and no beacon).
- [ ] loadHistoryItem sets lastSavedScenarioRef to the loaded item's scenario, so loading then immediately hitting a boundary does not re-save the same row.

### [P1] View switching calc/replayer/solver + toolbar gating (App.jsx)

*Risk:* Full-screen view takeover and the !user -> signIn() gates are the app's navigation backbone and currently only the calc view ever renders in tests.

- [ ] Clicking the 'Solver' toolbar button replaces the calculator with SolverView (sv-header 'Back' button + 'Solver' badge visible; 'Clear all'/'Upload log' gone); clicking Back returns to the calculator.
- [ ] Clicking 'Replayer' renders ReplayerView (calc toolbar gone) and openReplayer triggers commitToHistory before switching; ReplayerView's onExit returns to calc.
- [ ] Signed out: the 'Favorite' toolbar button is not rendered at all (user && guard), and the 'Sign in' button is.
- [ ] Signed out: clicking 'Upload log' opens the AuthModal (signIn()) and does NOT open UploadModal; signed in, it opens UploadModal.
- [ ] Signed out: saveHand path — no Favorite button exists, but calling save via a signed-out user opens AuthModal rather than the SaveModal.
- [ ] Theme toggle inside SolverView (onToggleTheme prop) flips the documentElement 'light' class, same as the calc-view toggle.

### [P1] UserChip dropdown (App.jsx UserChip)

*Risk:* Share and Hand history are only reachable through this menu when signed in; a regression strands both features.

- [ ] With AuthContext user {name:'Arun', email:'a@b.c'} (mock GET /api/auth/session), the chip shows 'Arun' and an initial avatar 'A'; with user.image set, an <img class='user-avatar-img'> renders instead.
- [ ] Clicking the chip opens the menu with exactly 'Hand history', 'Share', and 'Sign out' items plus the name/email header.
- [ ] 'Hand history' closes the menu, opens the HistoryDrawer, and triggers GET /api/searches (refreshHistory).
- [ ] 'Share' closes the menu and opens ShareModal whose input value is buildShareUrl output (contains the scenario hash).
- [ ] mousedown outside the chip wrapper closes the menu (document listener); mousedown inside does not.
- [ ] 'Sign out' calls signOut: POST /api/auth/signout fires and the chip is replaced by the 'Sign in' button (user cleared).

### [P1] AuthContext session/signIn/signOut + CSRF handling (AuthContext.jsx)

*Risk:* Every authenticated request depends on this flow; dropping the csrfToken from the form bodies or breaking the 429/invalid-credentials branches locks users out or hides rate-limit security signals.

- [ ] On mount, GET /api/auth/session ok:{user:X} sets user; ok:false or rejection sets user null and loading false either way.
- [ ] Providers fetch returning {google:{},credentials:{}} yields oauth=['google'] ('credentials' filtered out) and the AuthModal shows 'Continue with Google'; without google the button and divider are absent.
- [ ] submitCredentials (signin): fetches /api/auth/csrf first, then POSTs /api/auth/callback/credentials with redirect:'manual', Content-Type x-www-form-urlencoded, and a body containing csrfToken, username, password, redirect:'false'.
- [ ] Username is trimmed and lowercased before submit ('  Arun ' -> 'arun' in the request body).
- [ ] A 429 from the callback shows 'Too many sign-in attempts. Try again in a few minutes.' in the modal and keeps it open.
- [ ] When refresh() after the callback returns no user, the modal shows 'Invalid username or password'.
- [ ] signup mode: POST /api/auth/signup runs first; a non-ok response with {error:'taken'} surfaces 'taken' and the credentials callback is never called.
- [ ] signOut: fetches csrf, POSTs /api/auth/signout, and clears user even when the fetch rejects (finally block), then re-calls refresh().
- [ ] useAuth outside AuthProvider throws 'useAuth must be used inside AuthProvider'.

### [P1] HistoryDrawer filters, clear-unfavorited confirm, states (HistoryDrawer.jsx)

*Risk:* The two-step clear confirm is the only guard against bulk-deleting hands, and filter/count rendering has zero coverage.

- [ ] Tab counts: with 3 items (1 starred) the All badge shows 3 and Starred shows 1; clicking 'Starred' filters the list to starred rows only.
- [ ] 'Clear all' first click shows the inline confirm 'Clear unfavorited?' and does NOT call onClear; clicking 'Clear' calls onClear exactly once and dismisses the confirm; 'Cancel' dismisses without calling.
- [ ] Closing and reopening the drawer resets filter to 'all' and confirmingClear to false (useEffect on open).
- [ ] loading=true renders 'Loading hand history…'; error='HTTP 500' renders "Couldn't load history" + the message; empty list under the starred filter renders 'No favorited hands yet' vs 'No saved hands yet' under all.
- [ ] Replay item renders the REPLAY badge, 'Full hand', the blindsLabel, and '· 2 actions · click to replay' for actionCount 2 (singular 'action' for 1).
- [ ] Scenario item renders stageLabel from boardLen (0 Pre-flop, 3 Flop, 4 Turn, 5 River, other 'N board'), the hero-equity pill with toFixed(1)%, and the '· leader X' sub only when topName !== heroName.
- [ ] Star button has aria-label 'Favorite' when unstarred and 'Unfavorite' when starred and fires onToggleFavorite(id, !starred); delete fires onDelete(id).
- [ ] user=null shows 'Sign in to sync across devices' and omits the '500 hands' cap note.

### [P1] URL hash auto-load on mount (App.jsx first useEffect)

*Risk:* Shared links are the app's distribution mechanism; the replay-before-scenario precedence and hash stripping are untested.

- [ ] With a #r= replay hash in location (or readReplayFromUrl mocked to return a hand), App mounts directly into ReplayerView and strips the hash via history.replaceState.
- [ ] With a #s= scenario hash (use encodeScenario/buildShareUrl from scenario.js to produce a real one), the players/board/pot/callAmt load into the calculator, the hash is stripped, and the toast 'Loaded shared scenario' appears then disappears after ~3.6s (fake timers).
- [ ] The loaded scenario is pre-marked as saved (lastSavedScenarioRef set), so an immediate boundary (clearAll) issues no auto-save POST.
- [ ] When both could match, the replay branch wins (early return before readScenarioFromUrl).

### [P1] Solver side picker + board picker card blocking (SolverSetup.jsx SidePickerModal/CardPickerModal/usedForSide)

*Risk:* Card-blocking is correctness-critical for the solver input: allowing a board card into a hand silently produces impossible spots.

- [ ] Board CardPickerModal: cards already on other board slots render disabled (.used), but the current slot's own card stays clickable (id !== curId exemption); picking sets the slot and closes; 'Clear slot' nulls it.
- [ ] Side picker hand mode: a third card click is ignored (toggleCard prev.length < 2 guard); clicking a selected card deselects it; 'Confirm hand' is disabled until exactly 2 cards and saves {kind:'hand', cards}.
- [ ] usedForSide('OOP') blocks the 5 board cards and IP's hand cards in the grid (disabled buttons); range-typed opposing side blocks nothing extra.
- [ ] Range tab saves {kind:'range', keys} via RangePicker onSave; SideRow then shows 'Range · N combos · P% of hands' using combosFromKeys (e.g. ['AA'] -> 6 combos).
- [ ] Switching Hand/Range picker-tabs inside the modal keeps it open and swaps the body (mode state).
- [ ] SideRow with side {kind:'unset'} shows 'Not set — choose a hand or range' with separate 'Hand' and 'Range' buttons that call onEdit('hand')/onEdit('range').

### [P2] BetSizeEditor clamps and dedup (SolverSetup.jsx)

*Risk:* Bet sizes define the solve tree; an unclamped or duplicate size changes solver output without any visible error.

- [ ] Preset chip for a pct already in spot.betSizes is disabled (present.has) and addSize early-returns on duplicates.
- [ ] Adding 50% to [33,75,125] inserts in ascending sorted order.
- [ ] BetSizeChip edit: entering '5000' commits 900 and '0' commits 1 (Math.max(1, Math.min(900,...))); a non-numeric value falls back to the previous size.pct; Enter commits, Escape cancels.
- [ ] Removing a chip filters it from spot.betSizes; toggling the 'All-in' chip flips spot.allIn and the tree summary count (betSizes.length + allIn).

### [P2] Small presentational components (Cards.jsx, Seat.jsx, ShareModal.jsx, SolvingView)

*Risk:* Low-risk rendering details, but the seat rename commit/cancel logic and clipboard fallback have real branches.

- [ ] PlayingCard/CardChip/HistCard render 'T' as '10' and apply red styling for h/d via SUIT_RED.
- [ ] PlayerSeat rename: clicking the name shows an input; Enter commits the trimmed value via onRename (whitespace-only commits null); Escape restores the prior name; blur also commits; maxLength is 18.
- [ ] PlayerSeat remove '×' calls onRemove without triggering onOpen (stopPropagation); the equity block renders win/tie/equity toFixed(1) only when the equity prop is non-null.
- [ ] ShareModal copy: with navigator.clipboard.writeText mocked, clicking 'Copy link' writes the url and the button flips to 'Copied' (reverting after 1.8s with fake timers); with clipboard undefined it falls back to select + document.execCommand('copy').
- [ ] SolvingView shows Math.round(progress.pct*100)+'%', 'combosFromKeys(oop) × combosFromKeys(ip) combos', and the size count including the all-in increment.

## backend auth + API routes

*Currently covered:* The 27 existing tests cover signup field validation/normalization/duplicate/single-rate-limit (7), searches POST happy path + 401/403/basic 400s + name cleaning and GET 401/user-scoping/429 (11), and [id] PATCH/DELETE 401/403/ownership-404/favorite-update/delete (9), plus lib-level tests for readJsonBody/cleanName and the in-memory rateLimit. Nothing exercises backend/src/auth.ts (authorize, callbacks, provider gating) or backend/src/app/api/auth/[...nextauth]/route.ts, and none of the route tests assert the newer LRU behaviors: the prune orderBy/skip/deleteMany in searches POST, the touch->lastAccessedAt PATCH action, or the favorite flag on save.

### [P0] auth.ts authorize() — credentials login

*Risk:* This is the entire password check; a regression silently lets wrong passwords in, lets Google-only (null-password) accounts be hijacked via credentials, or reintroduces the username-enumeration timing oracle the DUMMY_HASH exists to prevent.

- [ ] Capture the NextAuth config by mocking next-auth's default export (vi.mock('next-auth', ...) returning {handlers:{},auth,signIn,signOut}) plus @auth/prisma-adapter and @/lib/prisma, then extract authorize from the captured CredentialsProvider; assert authorize is a function (test-harness smoke case).
- [ ] Unknown user: prisma.user.findUnique resolves null -> authorize returns null, AND bcrypt.compare was still called exactly once with the DUMMY_HASH string '$2b$10$E8gu9h1g2PhgJpgBLSPRYOGW1q7Xl3Cq.VMwDkH1KbCCJTRjnfkZ.' as the hash argument (constant-time dummy-compare path not skipped).
- [ ] Wrong password: findUnique returns {id:'u1',password:'<real bcrypt hash>'} and bcrypt.compare resolves false -> authorize returns null.
- [ ] Correct password: compare resolves true and user has a non-null password -> returns exactly {id,name,email} and the returned object has no 'password' key.
- [ ] Google-only account: findUnique returns a user with password:null; even with bcrypt.compare mocked to resolve true, authorize returns null (the `!user?.password` guard on line 30 of backend/src/auth.ts).
- [ ] Normalization: credentials {username:'  MixedCase  '} -> findUnique called with where:{email:'mixedcase'} (toLowerCase().trim() applied before the email-column lookup).
- [ ] Missing/empty credentials: username undefined, password undefined, and username:'   ' (trims to empty) each return null without calling prisma.user.findUnique or bcrypt.compare.

### [P0] searches POST — LRU prune (backend/src/app/api/searches/route.ts lines 88-96)

*Risk:* A wrong orderBy or skip silently deletes the user's favorites or most-recent saves instead of stale ones — unrecoverable data loss that no current test would catch (findMany is mocked to [] so the prune args are never asserted).

- [ ] After a successful create, prisma.search.findMany is called with exactly {where:{userId:'user1'}, orderBy:[{favorite:'desc'},{lastAccessedAt:'desc'},{createdAt:'desc'}], skip:500, select:{id:true}} (toEqual on the full arg, locking the orderBy array order and SAVE_CAP=500).
- [ ] When findMany resolves [{id:'old1'},{id:'old2'}], prisma.search.deleteMany is called with {where:{id:{in:['old1','old2']}}}.
- [ ] When findMany resolves [], deleteMany is NOT called.
- [ ] Prune still runs (findMany called) even when the created search itself is a favorite — i.e. prune happens unconditionally after create.
- [ ] If deleteMany rejects, POST returns 500 (prune failure does not return a fake-success 200 with the search).

### [P0] searches [id] PATCH — touch action and field whitelist

*Risk:* touch:true is what feeds lastAccessedAt, which is the second prune sort key; if it stops writing, the LRU ordering degrades to createdAt and the prune deletes recently-used saves.

- [ ] PATCH {touch:true} -> prisma.search.update called with data containing lastAccessedAt that is instanceof Date and within ~5s of Date.now() (use vi.useFakeTimers or a tolerance), and no other keys in data.
- [ ] PATCH {touch:true, favorite:false, name:'renamed'} -> update data has exactly {favorite:false, name:'renamed', lastAccessedAt:<Date>} — touch combines with other fields in one update.
- [ ] PATCH {touch:false} -> 400 'No valid fields to update' (only strict === true counts); same for {touch:'yes'} and {touch:1}.
- [ ] PATCH {} (empty object) -> 400 'No valid fields to update' and update not called.
- [ ] PATCH {favorite:'true'} (string, not boolean) -> 400 — non-boolean favorite is ignored by the typeof whitelist, leaving data empty.
- [ ] PATCH {name:'x'.repeat(201)} -> 400 (length>MAX_NAME means name is skipped, data empty); PATCH {name: 42} -> 400.
- [ ] PATCH {name:'Na​me'} -> update data.name === 'Name' (cleanName applied on PATCH, mirroring the POST test).
- [ ] update is called with where:{id:params.id} after ownedSearch passes (asserts the id actually patched is the route param, not the found row's field).

### [P1] auth.ts JWT/session callbacks and session config

*Risk:* session.user.id is the sole authorization key every searches route trusts; if the token.sub plumbing breaks, users read/delete each other's rows or auth() returns ids of undefined.

- [ ] jwt callback: jwt({token:{},user:{id:'u42'}}) returns a token with sub==='u42'.
- [ ] jwt callback without user (subsequent requests): jwt({token:{sub:'u42'}}) leaves sub unchanged.
- [ ] session callback: session({session:{user:{}},token:{sub:'u42'}}) sets session.user.id==='u42'.
- [ ] session callback with missing token.sub: session.user.id stays unset (no crash, no 'undefined' string).
- [ ] Captured config has session.strategy==='jwt' and session.maxAge===604800 (7 days).

### [P1] [...nextauth]/route.ts login throttle wrapper

*Risk:* This wrapper is the only brute-force throttle on credential sign-in; if the URL match or 429 short-circuit regresses, unlimited password guessing goes straight to authorize().

- [ ] POST with req.url containing '/callback/credentials' when limit('login', ip) returns {ok:false,retryAfter:120} -> 429, Retry-After header '120', and handlers.POST NOT called.
- [ ] Same URL when limit returns ok -> handlers.POST called once with the original req, and limit was called with ('login','1.2.3.4') using getClientIp's value.
- [ ] POST to a non-credentials URL (e.g. '/api/auth/signout' or '/callback/google') -> limit never called, handlers.POST called.
- [ ] GET is handlers.GET (exported reference equality) so the wrapper never throttles OAuth redirects.

### [P1] searches POST — favorite/isReplay persistence and remaining validation branches

*Risk:* favorite:true at save time is what shields a replayer save from the LRU prune; if the flag is dropped on create the row becomes silently evictable.

- [ ] POST body {...valid, favorite:true} -> prisma.search.create data.favorite === true; body without favorite -> data.favorite === false (the !!favorite coercion).
- [ ] POST {...valid, isReplay:1, replay:{steps:[]}} -> data.isReplay === true and data.replay passed through; replay omitted -> data.replay === null.
- [ ] board with 6 elements -> 400 'Invalid board'.
- [ ] name of 201 chars -> 400; name as a number -> 400 (typeof check); scenario as object -> 400 'Invalid scenario'; scenario string of 16385 chars -> 400 'Field too large'.
- [ ] playerNames matrix: 10-element array -> 400; element of 101 chars -> 400; element typeof number -> 400; [null,'alice'] -> 200 with data.playerNames stored.
- [ ] players JSON.stringify length > 16384 -> 400 'Field too large' (e.g. one player object with a 17000-char string).
- [ ] POST when limit('save','user1') returns {ok:false,retryAfter:30} -> 429 with Retry-After header '30' and prisma.search.create NOT called (current suite only tests 429 on GET, never asserts the header or the limit key ('save', userId)).
- [ ] prisma.search.create rejects -> 500 with {error:'Internal server error'}.
- [ ] Body with content-length header > 102400 -> 413 (readJsonBody MAX_BODY wiring), and a non-JSON body -> 400 'Invalid JSON'.

### [P1] searches [id] PATCH/DELETE — rate limit and error paths

*Risk:* PATCH/DELETE share the 'save' limiter; an unthrottled DELETE loop or a 500 masquerading as success would corrupt saved data.

- [ ] PATCH when limit('save','user1') returns {ok:false,retryAfter:45} -> 429 with Retry-After '45', and neither findFirst nor update called (rate check precedes the ownership read).
- [ ] DELETE under the same rate-limit mock -> 429 with Retry-After header, prisma.search.delete not called.
- [ ] DELETE asserts findFirst where:{id:'s1',userId:'user1'} (ownership-scope arg assertion exists for PATCH only today).
- [ ] prisma.search.delete called with where:{id:params.id} on success.
- [ ] prisma.search.update rejecting -> PATCH returns 500; prisma.search.delete rejecting -> DELETE returns 500.

### [P1] signup route — second limiter, headers, and boundary branches

*Risk:* The global signupAll limiter is the only defense against distributed signup floods, and it is currently never exercised; Retry-After values are also unasserted everywhere.

- [ ] limit mocked per-kind: ('signup', ip) ok but ('signupAll','all') returns {ok:false,retryAfter:600} -> 429, Retry-After '600', body mentions 'busy', and prisma.user.findUnique NOT called.
- [ ] Per-IP 429 includes Retry-After header equal to String(rl.retryAfter) (existing test only checks status 66-69).
- [ ] limit is called first with ('signup','1.2.3.4') then ('signupAll','all') — exact key assertions.
- [ ] username of 33 chars -> 400; username exactly 3 and exactly 32 chars -> 200 (boundary).
- [ ] password of 201 chars -> 400; password exactly 8 -> 200.
- [ ] username '  spaced  ' -> created with email 'spaced' (trim before length/regex checks).
- [ ] name omitted -> displayName falls back to the username; name of 100 chars -> stored name length 80 (the .slice(0,80) after cleanName).
- [ ] prisma.user.create rejects -> 500.
- [ ] Success response JSON is {user:{id,username,name}} and contains no 'password' or hash field anywhere in the body.

### [P2] auth.ts googleEnabled provider gating

*Risk:* If gating regresses, local/CI builds crash on missing OAuth secrets or prod silently ships without Google login.

- [ ] With vi.stubEnv GOOGLE_CLIENT_ID+GOOGLE_CLIENT_SECRET unset and vi.resetModules() + dynamic import of @/auth, the captured providers array has length 1 (credentials only).
- [ ] With both env vars stubbed to values, re-import yields providers length 2, second provider id 'google'.
- [ ] With only GOOGLE_CLIENT_ID set (secret missing), providers length is still 1 (the !!(A && B) condition).

### [P2] cross-site hardening completeness

*Risk:* sec-fetch-site is the CSRF backstop for cookie-authed mutations; the check must run before auth/rate-limit/DB on every mutating route or a cross-site page can still trigger writes.

- [ ] For each of POST /api/searches, PATCH and DELETE /api/searches/[id] with 'sec-fetch-site':'cross-site': 403 AND auth() was never called (current 403 tests assert status only, not that the check short-circuits before session/DB work).
- [ ] 'sec-fetch-site':'same-site' and 'same-origin' and a missing header all pass through to normal handling (non-browser clients without the header are not blocked).
- [ ] Signup POST intentionally has no sec-fetch-site check — document via a test that cross-site signup is allowed (or flag it for a product decision) so the asymmetry is explicit.

### [P2] searches GET ordering and response hygiene

*Risk:* Saved-list ordering regressions are user-visible but not destructive.

- [ ] GET asserts findMany called with orderBy:{createdAt:'desc'} (currently only where.userId is asserted).
- [ ] GET 429 includes Retry-After header and limit was called with ('read','user1').
- [ ] GET when prisma.search.findMany rejects -> 500.

## backend libs (body.ts, rateLimit.ts, prisma schema) + CI pipeline

*Currently covered:* body.test.ts (8 tests) covers cleanName happy path, single-char strips (ZWSP, RLO, BELL, BOM) and one NFC composition, plus readJsonBody parse/empty/declared-oversize/byte-vs-char oversize/invalid JSON. rateLimit.test.ts (4 tests) covers only getClientIp header precedence, trim, and unknown fallback. The actual rate-limiting logic — rateLimit() fixed-window counting, window expiry, the limit() dispatcher, per-kind LIMITS, the Upstash path and its redis-failure fallback — has zero tests, and CI has no coverage gate, schema-drift check, audit, or timeout policy.

### [P0] rateLimit() in-memory fixed-window mechanics

*Risk:* This is the only brute-force protection on login/signup when Upstash env vars are unset (the default in dev and any misconfigured deploy); a counting or expiry regression silently disables auth throttling.

- [ ] rateLimit('k', 3, 60000) returns ok:true for calls 1-3 and ok:false on call 4 within the same window
- [ ] blocked response computes retryAfter = Math.ceil((resetAt - now)/1000): with vi.setSystemTime, fill the bucket, advance 58500ms into a 60000ms window, assert the blocked call returns retryAfter === 2 (ceil, not floor)
- [ ] first call creates the bucket with count 1 and returns { ok: true, retryAfter: 0 }
- [ ] boundary: at now === resetAt exactly, `now > b.resetAt` is false so the old bucket still applies — a full bucket still blocks; at resetAt + 1ms the bucket resets and the call succeeds with a fresh count
- [ ] after advancing past windowMs, the counter restarts: a previously-exhausted key allows another full `limit` calls before blocking again
- [ ] key isolation: exhausting key 'a' does not affect key 'b' with the same limit/window
- [ ] (P2 sub-case) sweep at buckets.size > 5000: seed >5000 expired buckets via repeated calls with distinct keys, advance time past their resetAt, make one more call, and assert expired buckets were deleted while a still-live bucket retains its count (requires an exported test hook to read buckets.size, or vi.resetModules between tests since the Map is module-level shared state)

### [P0] limit() dispatcher: kind isolation, LIMITS consistency, Upstash wiring and failure fallback

*Risk:* If the `${kind}:${identifier}` key prefix or the catch-and-fall-through on redis errors regresses, login attempts share buckets with reads or rate limiting silently turns off when redis is down.

- [ ] kind isolation: with no Upstash env, exhaust limit('login', 'u1') (11 calls, 10 allowed); assert limit('save', 'u1') still returns ok:true because the in-memory key is 'login:u1' vs 'save:u1'
- [ ] per-kind config is applied: limit('login', x) blocks on the 11th call (n=10), limit('save', y) blocks on the 61st (n=60), limit('signupAll', z) on the 21st — pin the LIMITS numbers so an accidental edit fails a test
- [ ] LIMITS internal consistency: for every kind, parse the upstash window string ('5 m', '60 m', '10 m', '1 m') and assert it equals the ms field — catches drift between the sliding-window config and the in-memory fallback window
- [ ] Upstash success mapping: vi.stubEnv UPSTASH_REDIS_REST_URL/TOKEN, vi.mock('@upstash/ratelimit') and '@upstash/redis', vi.resetModules + dynamic import (hasUpstash/limiters are evaluated at module load); mocked limit() resolving { success: false, reset: Date.now()+5000 } must yield { ok: false, retryAfter: 5 }
- [ ] Upstash retryAfter clamp: mocked reset in the past (reset < Date.now()) yields retryAfter 0 via Math.max(0, ...), never negative
- [ ] redis-down fallback: mocked limiters[kind].limit rejecting must fall through to the in-memory rateLimit and still block after LIMITS[kind].n calls — i.e. a throwing redis client must NOT return ok:true unconditionally
- [ ] one Ratelimit instance per kind is constructed with prefix `rl:${kind}` (assert the mock constructor calls) so upstash keyspaces don't collide across kinds

### [P1] getClientIp spoofing and degenerate-header edges

*Risk:* The returned string is the rate-limit bucket key; a falsy/empty result collapses all clients into one shared bucket (mass DoS of legit users) or lets attackers rotate buckets.

- [ ] x-real-ip present but empty string ('') is falsy in `if (realIp)` — must fall back to x-forwarded-for's first entry, not return ''
- [ ] x-real-ip of only whitespace ('   ') currently passes the truthy check and returns '' after trim() — pin the desired behavior (should fall back, not produce an empty bucket key shared by all such clients)
- [ ] x-forwarded-for with leading/trailing spaces around entries (' 1.1.1.1 , 2.2.2.2') returns '1.1.1.1'
- [ ] x-forwarded-for that is just ',' or starts with a comma (',2.2.2.2') currently returns '' — pin/fix so the function never returns an empty key (fall through to 'unknown')
- [ ] spoofed x-forwarded-for is ignored whenever x-real-ip exists, including when xff contains attacker-controlled garbage like 'evil, 9.9.9.9' (extends the existing precedence test with adversarial values)

### [P1] cleanName unicode stripping ranges

*Risk:* cleanName sanitizes user-visible display names; the current ranges (body.ts lines 27-33) miss the bidi isolate block, so RTL spoofing of names is still possible, and the strip-after-normalize ordering can emit non-NFC output.

- [ ] bidi isolates U+2066 (LRI), U+2067 (RLI), U+2068 (FSI), U+2069 (PDI) and U+061C (Arabic Letter Mark) should be stripped — they fall OUTSIDE every current range (0x202a-0x202e stops before the isolates; 0x2060-0x2064 stops before 0x2066), so these tests fail today and expose a real sanitizer hole
- [ ] range boundary pins: 0x1F stripped / 0x20 (space) kept; 0x7E '~' kept / 0x7F DEL stripped / 0x9F stripped / 0xA0 NBSP kept (NBSP passing through is current intended behavior — pin it)
- [ ] astral-plane emoji survive: cleanName('a👍b') keeps the surrogate pair intact (the for...of code-point iteration is load-bearing; an index-based refactor would corrupt it)
- [ ] ZWJ emoji sequences are broken by design: U+200D falls in the 0x200b-0x200f strip range, so cleanName('👨‍👩‍👧') returns '👨👩👧' — pin this so a future range tweak is a conscious decision
- [ ] strip happens AFTER normalize with no re-normalize: cleanName('e' + '​' + '́') returns decomposed 'é' (the ZWSP blocks NFC composition, then gets stripped) — output is not guaranteed NFC; pin or fix by re-normalizing after the loop
- [ ] tab/newline/CR are stripped via c < 0x20: cleanName('a\tb\nc\r') === 'abc'
- [ ] max-length interaction: a string of N decomposed 'é' pairs shrinks from 2N to N code units after NFC — assert cleanName output length so callers that validate length BEFORE cleaning (signup name checks) can't be bypassed with padding that disappears
- [ ] empty string returns '' and a string of only strippable chars ('​﻿‮') returns ''

### [P1] readJsonBody boundaries and parse-result shape

*Risk:* Every API route trusts this gate for payload caps and JSON validity; off-by-one or status regressions change billing-relevant save limits and error semantics.

- [ ] exact boundary acceptance: body with Buffer.byteLength === maxBytes is accepted; maxBytes + 1 byte is rejected (test both sides, including a multibyte case where a 3-byte '✓' lands the total exactly on the cap)
- [ ] status codes, not just error-defined: oversize returns error with status 413, malformed JSON returns status 400 (existing tests only assert error is defined, so swapping the codes would pass today)
- [ ] non-numeric content-length header ('abc'): Number('abc') is NaN and NaN > maxBytes is false, so the declared-size guard is skipped — a small valid body still parses, an oversize body is still caught by the byteLength check
- [ ] lying content-length: declared '10' with an actual body over maxBytes is rejected by the second (byteLength) guard — proves the declared check is an optimization, not the only defense
- [ ] JSON primitives pass through: '"hi"' yields data 'hi', '42' yields 42, 'null' yields null (NOT {}), '[1,2]' yields an array — pin this since route handlers destructure data as an object and null would throw downstream
- [ ] (P2) request.text() rejecting (aborted stream) currently propagates an unhandled rejection out of readJsonBody — decide whether it should return a 400 error object and pin the behavior

### [P1] CI: prisma schema guard (gap — pipeline suggestions, not unit tests)

*Risk:* backend/prisma contains only schema.prisma with no migrations directory, so nothing in CI detects an invalid schema beyond generate, and schema/database drift is undetectable.

- [ ] add an explicit `npx prisma validate` step before `prisma generate` in the backend job (cheap, gives a clearer failure than a generate stack trace)
- [ ] create a baseline migration (`prisma migrate dev --name init` against a dev DB, commit prisma/migrations/) and add a CI step `npx prisma migrate diff --from-migrations ./prisma/migrations --to-schema-datamodel ./prisma/schema.prisma --exit-code` so schema edits without a migration fail the build
- [ ] alternatively (if staying on `db push` workflow) add a scheduled job that runs `prisma migrate diff --from-url $DATABASE_URL --to-schema-datamodel` against staging to surface drift
- [ ] add a format check `npx prisma format --check` (or validate in CI after format) to keep schema diffs reviewable

### [P1] CI: coverage, timeouts, and run hygiene (gap — pipeline suggestions)

*Risk:* With no coverage threshold a PR can delete the entire rateLimit test file and CI stays green; with no timeout a hung vitest watcher burns the 6-hour default runner limit.

- [ ] add @vitest/coverage-v8 to both frontend and backend, switch CI to `vitest run --coverage`, and set coverage.thresholds (e.g. lines/branches floor per package) in frontend/vitest config and backend/vitest.config.ts so coverage can only ratchet up
- [ ] set `timeout-minutes: 10` (frontend) / `timeout-minutes: 15` (backend) on both jobs in .github/workflows/ci.yml
- [ ] add a workflow-level `concurrency: { group: ci-${{ github.ref }}, cancel-in-progress: true }` so superseded PR pushes don't queue duplicate runs
- [ ] document the paths-ignore interaction: '**.md' is ignored only on push to main while pull_request always runs — if branch protection ever requires the Frontend/Backend checks, md-only direct pushes will have no status; either drop paths-ignore or use required-check-friendly path filtering

### [P2] CI: dependency audit, node matrix, worker-test convention, smoke stage (gap — pipeline suggestions)

*Risk:* next-auth is pinned to a beta (5.0.0-beta.31) and the app handles credentials, so unaudited dependency drift is a real exposure; workers and the built app have no automated check at all.

- [ ] add a dependency-audit step per job: `npm audit --omit=dev --audit-level=high` (or an osv-scanner action) so known-vulnerable transitive deps fail the build instead of rotting
- [ ] run jobs on a node matrix `node-version: [20, 22]` (or at minimum pin to the exact Vercel runtime major) to catch Buffer/Intl/fetch behavior differences before deploy
- [ ] establish a worker-mocking convention: frontend/src/equityWorker.js and solverWorker.js are uncovered because jsdom has no Worker — keep them as thin postMessage shells over pokerEngine/solverEngine (already mostly true), add a `vi.stubGlobal('Worker', FakeWorker)` test helper, and write one message-protocol test per worker asserting the request→response message shape so a renamed field can't silently break the UI
- [ ] add a smoke/e2e stage (Playwright) gated on PRs: build frontend, serve dist, load the app, run one odds calculation and one replay import end-to-end — currently `npm run build` succeeding is the only proof the bundles even boot

## Cross-cutting (completeness critic)

### [P1] CSP inline-script hash and security-header regression checks for frontend/vercel

CSP inline-script hash and security-header regression checks for frontend/vercel.json and backend/vercel.json (no auditor owned either vercel.json). The CSP in frontend/vercel.json pins script-src to 'sha256-z+XpIhDZ4BPRQs6misjQm+ZEqKCsrGAqbdmeWQTMIFo=' which must equal the hash of the inline theme script in frontend/index.html (verified it matches today). No test or CI step recomputes the hash from the built index.html, validates the JSON, or asserts the hardening headers (HSTS, frame-ancestors, X-Content-Type-Options, the /api/:path* rewrite target) survive edits.

*Why:* These headers were the deliverable of the 'harden auth, csrf, and input validation' work, and the hash is a silent production-breaker: any edit to the inline script in index.html ships a CSP violation that blocks the script in prod while every unit test and the dev server stay green. A 10-line vitest (read index.html, sha256 it, compare to vercel.json) plus a headers snapshot is cheap and is the only thing that can catch this class of regression.

### [P1] Frontend-to-backend API contract tests with shared fixtures

Frontend-to-backend API contract tests with shared fixtures. frontend/src/App.jsx (saveReplayToHistory ~line 257, onImportConfirm ~line 298, auto-save ~line 509) and frontend/src/AuthContext.jsx (/api/auth/csrf, /api/auth/callback/credentials form-encoded, /api/auth/providers, /api/auth/signup, /api/auth/signout) define one side of a contract; backend route tests validate the other side using independently hand-written payloads. Nothing asserts that the exact payloads the frontend sends pass backend validation (field whitelist, cleanName, readJsonBody MAX_BODY=100KB vs a large imported replay JSON) or that backend response shapes ({search:{id}}, error bodies, NextAuth csrfToken field) match what the frontend parses.

*Why:* The two halves live in separate packages with separate test runners (jsdom vitest vs node vitest), so either side can drift without any test failing — e.g. backend renaming a response field, tightening the body cap below a real 100-action imported replay, or NextAuth beta changing the csrf/session shape would only surface in production. A shared-fixture file imported by both suites (or a supertest-style test that feeds real App.jsx payload builders into the route handlers) closes the seam; no auditor owned cross-package anything.

### [P1] Cross-subsystem round-trip integration tests: parsePokerNowLog -> convertHandsFor -> the replay object -> initState/buildReplay frames -> encodeReplay -> decodeReplay -> ReplayerView render; and decodeScenario -> simulate

Cross-subsystem round-trip integration tests: parsePokerNowLog -> convertHandsFor -> the replay object -> initState/buildReplay frames -> encodeReplay -> decodeReplay -> ReplayerView render; and decodeScenario -> simulate. Every auditor tested their codec/engine in isolation with synthetic inputs; no test ever feeds one subsystem's real output into the next subsystem's input. Real PokerNow export logs already sit in /Users/arun/Downloads/PokerNow Import and /Users/arun/Downloads/PokerNow Import 2 and could seed a fixture corpus.

*Why:* The import->replay pipeline is the product's main data path, and the hand object produced by pokernowImport.js is consumed by replayerEngine.js/replayShare.js with no shared schema or type — a field rename, cents-vs-chips mismatch, or seat-index convention change passes all eight subsystems' unit suites while breaking every imported hand. One test that imports a real log fixture and steps the resulting replay to showdown (asserting pot conservation and a successful share round-trip) would catch whole-pipeline drift no per-subsystem test can.

### [P2] Backend Next

Backend Next.js UI shell is an unowned, partly broken surface: backend/src/app/page.tsx does redirect('/auth/signin') but no /auth/signin route exists anywhere under backend/src/app (only api/*), so the backend root 404s; backend/src/components/Header.tsx, auth/UserMenu.tsx, auth/SignInButton.tsx, ColorModeToggle.tsx, backend/src/contexts/AuthContext.tsx (a second, divergent AuthContext), app/providers.tsx, app/theme.ts have zero tests and appeared in no auditor's scope.

*Why:* This is vestigial scaffolding that drags @chakra-ui, @emotion, and framer-motion into the production backend bundle and contains a live broken redirect; it either needs a smoke test pinning intended behavior or (more likely) deletion, but because no auditor owned it the audit would sign off with these files invisible. Dead duplicated auth context code next to the real auth code is also where stale security logic hides.

### [P2] Bulk-import vs rate-limit vs LRU-prune composition: UploadModal MAX_HANDS=50 drives 50 sequential POSTs in App

Bulk-import vs rate-limit vs LRU-prune composition: UploadModal MAX_HANDS=50 drives 50 sequential POSTs in App.jsx onImportConfirm against the 'save' limiter (n=60/min in backend/src/lib/rateLimit.ts); a 429 makes r.ok false and the hand is silently dropped (only counted via 'saved++'), and the searches POST LRU prune can evict older unfavorited history mid-import. No test exercises the composed flow or the frontend's behavior on 429 during import.

*Why:* Each piece is individually flagged (modal cap, route limiter, LRU prune) but their interaction is exactly where users lose data silently: an import burst after normal auto-save traffic crosses 60/min and hands vanish with a cheerful 'N hands added' toast. A single integration test posting 50 import payloads against the route with the in-memory limiter would pin the intended budget and the user-visible failure mode.

### [P2] App bootstrap and theme-key contract: frontend/index

App bootstrap and theme-key contract: frontend/index.html's inline script and App.jsx both hard-code the localStorage key 'holdem_theme_v1' and the documentElement class 'light' with no shared constant and no test; frontend/src/main.jsx (AuthProvider wrapping, StrictMode double-invoked effects against the worker/auto-save/beacon effects in App.jsx) is mounted by no test.

*Why:* These are the only files in frontend/src with literally zero owner in the audit. The duplicated key/class strings are a classic drift pair (rename one, dark-flash returns), and StrictMode's double effect invocation is precisely the regime in which App.jsx's worker spawn (line 395), auto-save POST, and unload beacon can double-fire — none of which any jsdom test currently mounts through the real entry composition.

### [P2] No deterministic-RNG seam for the Monte Carlo paths: pokerEngine

No deterministic-RNG seam for the Monte Carlo paths: pokerEngine.js simulate, equityMatchup's partial-board sampling, and the statistical preflop-band tests all use raw Math.random with no injectable/seedable RNG, and no auditor flagged the flaky-test modality or a seed-based reproducibility strategy (vitest retry/tolerance policy, seeded shuffle for exact-assertion tests).

*Why:* Two auditors are about to write more statistical tests (range players in simulate, equityMatchup Monte Carlo) on top of an already band-asserted suite; without a seed seam every new test either widens tolerances (weak) or flakes in CI (erodes trust in the whole pipeline the CI auditor is hardening). Threading a rng parameter is a small refactor that converts several proposed statistical tests into exact ones.
