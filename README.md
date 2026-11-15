# NeuroVision

**Sebastian Villalba, Jonathan Zheng, Ekagra Jain, and Pronita Ghimire**
HackPrinceton 2026

**[Try it](https://neurovision-app-kappa.vercel.app/)** — the live app, in the browser, nothing to install.

NeuroVision is a three-test battery for hemispatial neglect that runs in an ordinary web browser, with no installation and no extra hardware. Each test produces a signed left–right index and a standard error. A probabilistic evidence model standardizes those indices against healthy norms and combines them into a posterior over a leftward lean, a rightward lean, or balanced attention.

It is a research prototype, not a diagnostic device. Its output describes one session. It does not diagnose a condition.

## The problem

Spatial neglect is a failure to attend to, or act on, one side of space after brain injury, most often the left side after a right-hemisphere stroke. People who have it tend to overestimate their own spatial abilities, so they are unlikely to report it. A review of 41 studies put its occurrence at about 29% of stroke survivors. In one inpatient cohort, patients with neglect fell 6.5 times more often than those without.

Three weaknesses of usual practice motivate the battery:

1. **No single test is enough.** Cancellation and line bisection dissociate, and neglect has more than one component. A European Academy of Neurology panel recommended a cancellation test first and further tests, such as line bisection, when time allows.
2. **Paper tests lose sensitivity as people compensate.** Untimed paper tasks can be passed by patients who still miss brief, unpredictable targets on a computer.
3. **Testing is occasional and tied to the clinic.** A paper sheet records what was missed at one visit. It does not record search order or timing, and it is not something a person repeats at home.

## The battery

The three scored tests run back to back, with no feedback between them and one combined report at the end. Each can also be opened on its own. A demonstration run plays all three and saves nothing. The whole session is meant to take about three minutes.

| | Starry Night | Hollow Rings | Line bisection |
| --- | --- | --- | --- |
| Task | Press when a red dot flashes among flickering green dots | Select every hollow ring among solid disks | Mark the middle of a horizontal line |
| Stimuli | 15 targets on an 8×4 grid; 60 distractors | 24 rings and 24 disks, 12 of each per side, mirrored | 5 lines, lengths 200–700 board units |
| Time | About 50 s | Up to 60 s | Up to 15 s per line |
| Response | One key or a tap anywhere | Pointer selection | One pointer mark |
| Lateral index | Left hit rate minus right hit rate | Right omission rate minus left omission rate | Negated mean signed error (% of line length) |
| Also recorded | Reaction time per target, hit rate by column, false alarms | Selection order, timing, search path, omissions by region | Error per line |

Board units are each task’s fixed coordinates, scaled to the window. Hollow Rings and line bisection use a 960×540 board. The code matches the counts and the line lengths in the table (stored order 600, 400, 700, 200, 500).

**Starry Night** adapts the dynamic detection test of Deouell, Sacher, and Soroker. Sixty green dots appear and vanish (each lasting 250–750 ms). A larger red dot is shown for 1000 ms. A press from 150 to 1500 ms after onset is a hit; earlier presses, and presses with no target, are false alarms. Gaps before targets are drawn from 800–2500 ms. Targets split 7/8 across the two sides, in random cells, with no more than three in a row on one side. There is no fixation point. The response is the same for a left target and a right target, so a slow hand cannot imitate a spatial bias. Hiding the browser tab pauses the run and the interrupted target is shown again, so a half-seen trial is not scored.

**Hollow Rings** is a cancellation board. The two halves match item for item. Every selection is stored with its time and position. The report shows hits, the left–right omission gap, the order of responses, and omissions by region. Search order is reported separately from the miss count.

**Line bisection** shows the five lines one at a time. Each line is offset so its midpoint is not the middle of the screen. The error is the signed distance from the true midpoint as a percentage of line length, positive to the right. No feedback is given during the task. Healthy people show a small leftward error (pseudoneglect), so a raw error is read against a healthy norm, not against zero.

**Hidden scene** is a demonstration, not a measurement. The picture looks complete. After every bird is tapped and Done is pressed, the left 35% fades in, with birds that were never on screen. Taps are stored with time and position for that page’s export. The result is induced by the display, so it is not scored and it does not enter the model.

The mounted app uses the pointer and, for Starry Night, the keyboard or a tap. A webcam screening lab and a gaze-analysis package exist in the repository and are not part of this battery: they are not in the nav, and the three tests do not use a camera.

## The evidence model

Negative on every index means the left side is weaker. Each index carries a standard error from the short test (adjusted proportions for the two rates; the standard deviation of the five bisection errors, divided by √5). Standardizing subtracts the healthy mean and divides by the healthy spread combined with that standard error, so a noisy result is pulled toward zero.

The three tests are treated as noisy views of one latent lean. The model returns:

- A posterior over balanced, left lean, and right lean. “Strong evidence” needs at least 0.95, “leans toward” at least 0.80, and “balanced” needs the balanced hypothesis at 0.80 or above. Anything else is inconclusive.
- The size of the lean: the posterior mean of that latent value and a 5th–95th percentile interval.
- Per-test Bayes factors, for explanation. The joint result uses one shared lean and is not the product of those factors.
- A discordance flag when a test’s residual against the other tests exceeds 2.5 in absolute value. Disagreement is reported rather than averaged away.

The sensitivities are 1 until data can estimate them. The hypothesis priors are one third each. These choices, and the thresholds, are assumptions.

Placeholder norms are built into the software and marked as assumed. Any result that uses them carries a notice.

| Test | Index | μ | σ |
| --- | --- | --- | --- |
| Starry Night | Hit-rate difference | 0 | 0.15 |
| Hollow Rings | Omission-rate difference | 0 | 0.06 |
| Line bisection | Negated mean error (%) | +1 | 3 |

A consented full live battery can be marked as a healthy-control sample. Once five such records are stored, scoring replaces the placeholders with an Eq. (9) fit that shrinks toward the table above with κ = 8, and the notice says the values are fitted. Below five samples the placeholders stay.

`scoreBatteryRecord` in `packages/domain` recomputes the tests and the combined posterior from the raw log. The on-screen report shows the per-test indices, the spatial plots, and a healthy-range reading. It does not yet show the combined posterior, the lean interval, or the discordance flag.

Clock drawing, greyscales, and practice-round helpers still live in `packages/domain`. They are not part of the three-test battery and their screens are not mounted.

## Pilot at HackPrinceton

The first study was 20 healthy adult volunteers on 14 November 2026, each completing one live session between 4:02 and 8:36 PM Eastern. Every complete live session in the database was included. Each had one Hollow Rings board and the five bisection lines, from a mouse or trackpad. No names, ages, handedness, or reading direction were collected. The aims were to fit norms, measure test–retest reliability, check the false-positive rate, and check sensitivity to an induced asymmetry. The pilot finishes the norm fit for two tests and gives an in-sample look at false positives. Test–retest and the induced-asymmetry check have not been run.

Indices were computed with the application’s scoring code and fitted with Eq. (9), κ = 8. With n = 20 the data carry about 71% of the weight for the mean and about 70% for the variance.

| Test | n | Raw mean | Raw SD | μ̂ | σ̂ | Fitted range (μ̂ ± 2σ̂) |
| --- | --- | --- | --- | --- | --- | --- |
| Starry Night | 0 | — | — | placeholder | placeholder | −0.300 to +0.300 |
| Hollow Rings | 20 | 0.000 | 0.027 | 0.000 | 0.040 | −0.080 to +0.080 |
| Line bisection | 20 | +0.260 | 1.065 | +0.471 | 1.862 | −3.252 to +4.194 |

Hollow Rings is at ceiling: 18 of 20 people found all 24 rings (mean 23.9 of 24). One missed a single right-side ring (+0.083) and one a single left-side ring (−0.083), so the fitted spread still leans on the placeholder. Line bisection’s index ran from −2.17 to +1.64. The raw mean of +0.26 is a small leftward placement, in the direction of pseudoneglect and smaller than the +1 the placeholder assumed. The mean absolute error was 1.63% of line length (SD 0.66).

Under the fitted norms, no participant exceeded |z| = 2 on either test (largest |z| 0.73 on Hollow Rings and 1.19 on line bisection). The evidence model, given those two scores, called 19 of 20 “balanced” and one “inconclusive” (P(balanced) = 0.77). None received “leans” or “strong”. The highest posterior on a lean was 0.21. This check is in-sample: the norms were fit on the same 20 people, and Starry Night did not enter. A proper false-positive rate needs norms from one group applied to another.

The build used at the event showed the Starry Night result and did not store it, so Starry Night could not be fitted. This tree does store Starry Night hits and the battery record. The app fits norms only from records marked healthy-control. The pilot sessions were not stored with that flag, so the fit above was computed offline with the same routine, and a deployment that does not already hold five flagged control batteries still scores against the placeholder table.

What is still open: Starry Night norms from new stored runs, test–retest reliability, an out-of-sample false-positive rate, sensitivity to an induced asymmetry, and any study in stroke survivors. A healthy-volunteer study cannot show that the battery detects neglect.

During the event the tests, the model, and the pilot plan were shown to Taryn Zawady, MD, a clinical safety scientist in oncology. She encouraged taking the work to stroke clinicians and to patients. She does not specialize in stroke or neglect, and the conversation was informal. It is not a validation and it says nothing about accuracy.

## Limitations

- No patient data. Claims about sensitivity come from the literature on the paradigms, not from NeuroVision results.
- The fitted norms are from 20 people, and the placeholder still carries about 30% of the weight. Starry Night has no fitted norm. The model treats the tests as independent given the latent lean.
- Eighteen of 20 healthy Hollow Rings runs were perfect.
- The volunteers were healthy and young. Bisection bias changes with age.
- Hollow Rings and line bisection require a pointer movement, so arm weakness and visual field loss can affect them. Starry Night uses a red/green distinction; colour-vision deficiency has not been tested.
- Screen size, viewing distance, lighting, and distraction are uncontrolled at home. Stimulus visual angle is not fixed.
- The on-screen report does not yet show the combined posterior.

## In the repository

The live app is a React and Vite site with a Fastify API and Postgres. Scoring and the evidence model are in `packages/domain`; the battery UI is `apps/web`, with `apps/api`, `apps/worker`, `packages/gaze`, and `packages/storage` beside it.

| Doc | Contents |
| --- | --- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Contracts, scoring, and how the app is delivered |
| [docs/OWNERSHIP.md](docs/OWNERSHIP.md) | Which workstream may edit which tree |
| [docs/BACKEND.md](docs/BACKEND.md) | API and worker |
| [docs/NORMS.md](docs/NORMS.md) | Which tests enter the model, and the placeholder table |
| [docs/MERGE_ORDER.md](docs/MERGE_ORDER.md) | Intended land order for workstreams A–F |
| [docs/DEMO_REHEARSAL.md](docs/DEMO_REHEARSAL.md) | Demonstration-session script |
| [docs/RELEASE_EVIDENCE.md](docs/RELEASE_EVIDENCE.md) | Latest recorded test and build evidence |

The repository was built as parallel workstreams. Agent A owns `packages/domain` and `docs/`. Agent B owns storage, the API, and the worker. Agent C owns `packages/gaze`. Agents D and E own the product UI. Agent F owns the web service layer. [docs/OWNERSHIP.md](docs/OWNERSHIP.md) is the rule for who edits which folder. A few of those docs still describe practice screens and a gaze lab in the product UI; those pages are not mounted. This file and `apps/web/src/App.tsx` are what a visitor sees.
