# NeuroVision

**Sebastian Villalba, Jonathan Zheng, Ekagra Jain, and Pronita Ghimire**
HackPrinceton 2026

**[Try it](https://neurovision-app-kappa.vercel.app/)** — the live app, in the browser, nothing to install.

NeuroVision is a three-test battery for hemispatial neglect. It runs on an ordinary computer in about three minutes, with no extra hardware. Each test produces a signed left–right index and a standard error. A probabilistic evidence model standardizes those indices against healthy norms and combines them into a posterior over a leftward lean, a rightward lean, or balanced attention.

It is a research prototype, not a diagnostic device. Its output describes one session. It does not diagnose a condition.

## The problem

Spatial neglect is a failure to attend to, or act on, one side of space after brain injury, most often the left side after a right-hemisphere stroke. People who have it tend to overestimate their own spatial abilities, so they are unlikely to report it. A review of 41 studies put its occurrence at about 29% of stroke survivors. In one inpatient cohort, patients with neglect fell 6.5 times more often than those without.

Three weaknesses of usual practice motivate the battery:

1. **No single test is enough.** Cancellation and line bisection dissociate, and neglect has more than one component. A European Academy of Neurology panel recommended a cancellation test first and further tests, such as line bisection, when time allows.
2. **Paper tests lose sensitivity as people compensate.** Untimed paper tasks can be passed by patients who still miss brief, unpredictable targets on a computer.
3. **Testing is occasional and tied to the clinic.** A paper sheet records what was missed at one visit. It does not record search order or timing, and it is not something a person repeats at home.

## The battery

The three scored tests run back to back, with no feedback between them and one combined report at the end. Each can also be opened on its own. A demonstration run plays all three and saves nothing.

| | Starry Night | Hollow Rings | Line bisection |
| --- | --- | --- | --- |
| Task | Press when a red dot flashes among flickering green dots | Select every hollow ring among solid disks | Mark the middle of a horizontal line |
| Stimuli | 15 targets on an 8×4 grid; 60 distractors | 24 rings and 24 disks, 12 of each per side, mirrored | 5 lines, lengths 200–700 board units |
| Time | About 50 s | Up to 60 s | Up to 15 s per line |
| Response | One key or a tap anywhere | Pointer selection | One pointer mark |
| Lateral index | Left hit rate minus right hit rate | Right omission rate minus left omission rate | Negated mean signed error (% of line length) |
| Also recorded | Reaction time per target, hit rate by column, false alarms | Selection order, timing, search path, omissions by region | Error per line |

Board units are each task’s fixed coordinates, scaled to the window. Hollow Rings and line bisection use a 960×540 board. The implementation matches the counts above and the line lengths 600, 400, 700, 200, and 500 board units, in that order.

**Starry Night** adapts the dynamic detection test of Deouell, Sacher, and Soroker. Sixty green dots appear and vanish (each lasting 250–750 ms). A larger red dot is shown for 1000 ms. A press from 150 to 1500 ms after onset is a hit; earlier presses, and presses with no target, are false alarms. Gaps before targets are drawn from 800–2500 ms. The 15 targets split 7 and 8 across the two sides, in random cells of the grid, with no more than three in a row on one side. There is no fixation point. The response is the same action for a left target and a right target, so a slow hand cannot imitate a spatial bias. It is the only scored test that measures noticing without a reach to the target. Hiding the browser tab pauses the run, and the interrupted target is shown again, so a half-seen trial is not scored.

**Hollow Rings** is a cancellation board, the kind of test most often recommended as the primary screen. The two halves match item for item, and the person has to tell rings from similar disks. Every selection is stored with its time and position. The report shows hits, the left–right omission gap, the order of responses, and omissions by region. Search order is a separate signal from the miss count: in a large patient study the starting point of the search was the most sensitive paper measure, and a paper sheet does not record it.

**Line bisection** shows the five lines one at a time. Each line is offset so its midpoint is not the middle of the screen. The error is the signed distance from the true midpoint as a percentage of line length, positive to the right. No feedback is given during the task. It asks for a judgement of extent, a different component from visual search, and the two dissociate. Healthy people show a small leftward error (pseudoneglect), so a raw error is read against a healthy norm, not against zero. On its own, bisection misses many cases, so it stays the secondary test.

**Hidden scene** is a demonstration, not a measurement. The picture looks like a complete dawn landscape. After every visible bird is tapped and Done is pressed, the left 35% fades in, with birds that were never on screen. Nothing felt missing, which is how neglect is experienced and why it goes unreported. Taps on that page can be exported with their time and position. The result is induced by the display, so it is not scored and it does not enter the model.

The battery uses the pointer and, for Starry Night, one key or a tap. It does not use a camera, an eye tracker, or a calibration step. Gaze-analysis code in the repository is not part of these three tests and is not on the live app’s nav.

## Repeated use at home

Neglect changes over time, and a single clinic score is noisy. A short test that can be repeated gives more measurements and shows the direction of change.

The hosted app is the link above. A run is labelled with a participant ID of 3–32 letters, digits, or dashes. No name is collected. The same ID opens that participant’s saved sessions, and a session can be exported as JSON. Every response is stored with its time and position, and scoring is a deterministic function of that log, so an old session can be re-scored when norms change. History places two sessions on the same trend only when they are comparable live assessments. Demonstration runs stay off the trend.

The project can also be packaged as one HTML file that opens offline. In that file, results stay in memory while the page is open; closing it drops them. The hosted app is the one that keeps sessions.

## The evidence model

Negative on every index means the left side is weaker. Each index carries a standard error from the short test (adjusted proportions for the two hit and omission rates; the standard deviation of the five bisection errors, divided by √5). Standardizing subtracts the healthy mean and divides by the healthy spread combined with that standard error, so a noisy result from few trials is pulled toward zero and cannot by itself produce a confident conclusion. The healthy mean absorbs biases such as pseudoneglect.

The three tests are treated as noisy views of one latent lean. Agreement strengthens the conclusion more than any single test could, and one odd result is diluted. The model returns:

- A posterior over balanced, left lean, and right lean. “Strong evidence” needs at least 0.95, “leans toward” at least 0.80, and “balanced” needs the balanced hypothesis at 0.80 or above. Anything else is inconclusive, with the advice that more trials would settle it.
- The size of the lean: the posterior mean and a 5th–95th percentile interval.
- Per-test Bayes factors, so it is clear which test drives the result. Those factors are for explanation. The joint result uses one shared lean and is not their product.
- A discordance flag when a test’s residual against the other tests exceeds 2.5 in absolute value. Because the components of neglect dissociate, disagreement is reported rather than averaged away.

Each test’s sensitivity is set to 1 until data can estimate it. The three hypotheses start with equal prior probability. Those choices, and the verdict thresholds, are assumptions. The model also treats the tests as independent given the latent lean, which ignores shared factors such as fatigue.

Placeholder norms are built into the software and marked as assumed. Any result that uses them carries a notice.

| Test | Index | μ | σ | Basis |
| --- | --- | --- | --- | --- |
| Starry Night | Hit-rate difference | 0 | 0.15 | Assumed symmetric |
| Hollow Rings | Omission-rate difference | 0 | 0.06 | Assumed symmetric, few omissions |
| Line bisection | Negated mean error (%) | +1 | 3 | Small leftward healthy error |

A consented full live battery can be marked as a healthy-control sample. Once five such records are stored, scoring replaces the placeholders with a fit that shrinks toward the table above, giving the placeholder the weight of κ = 8 participants. Below five samples the placeholders stay. As more control sessions accumulate, the placeholder’s influence fades.

The scoring library recomputes each test and the combined posterior from the raw log. The on-screen report shows the per-test indices, the spatial plots, and a healthy-range reading. It does not yet show the combined posterior, the lean interval, or the discordance flag.

## Pilot at HackPrinceton

The first study was 20 healthy adult volunteers on 14 November 2026, each completing one live session between 4:02 and 8:36 PM Eastern. Every complete live session in the database was included. None was a demonstration, a partial run, or an induced-asymmetry run. Each had one Hollow Rings board and the five bisection lines, from a mouse or trackpad, across three window sizes. No names, ages, handedness, or reading direction were collected.

The aims, stated in advance, were to fit healthy norms, measure test–retest reliability, check the false-positive rate, and check sensitivity to a known asymmetry by dimming one half of the display. The pilot finishes the norm fit for two of the three tests and gives an in-sample look at false positives. Test–retest and the induced-asymmetry check have not been run.

Indices were computed with the application’s scoring code and fitted with the same shrinkage rule (κ = 8). With 20 people the measured data carry about 71% of the weight for the mean and about 70% for the variance.

| Test | n | Raw mean | Raw SD | Fitted μ | Fitted σ | Fitted range (μ ± 2σ) |
| --- | --- | --- | --- | --- | --- | --- |
| Starry Night | 0 | — | — | placeholder | placeholder | −0.300 to +0.300 |
| Hollow Rings | 20 | 0.000 | 0.027 | 0.000 | 0.040 | −0.080 to +0.080 |
| Line bisection | 20 | +0.260 | 1.065 | +0.471 | 1.862 | −3.252 to +4.194 |

Hollow Rings is at ceiling, which is what a cancellation screen expects of people without neglect. Eighteen of 20 people found all 24 rings (mean 23.9 of 24). One missed a single right-side ring (index +0.083) and one a single left-side ring (−0.083), so the fitted spread still leans on the placeholder.

Line bisection’s index ran from −2.17 to +1.64. The raw mean of +0.26 is a small leftward placement: in the direction of pseudoneglect, and smaller than the +1 the placeholder assumed, so the fitted mean moved to +0.47 and the fitted range is narrower. The mean absolute error was 1.63% of line length (SD 0.66).

Under those fitted norms, no participant exceeded |z| = 2 on either test. The largest values were 0.73 on Hollow Rings and 1.19 on line bisection. The evidence model, given those two scores, called 19 of 20 “balanced” and one “inconclusive” (posterior on balanced attention 0.77). None received “leans” or “strong”. The highest posterior on a lean was 0.21.

This is not yet the false-positive check the study aimed for. The norms were fit on the same 20 people they were then applied to, which favours a low rate, and only two of the three tests entered. The proper check needs norms from one group applied to another.

The build used at the event drew the Starry Night result and did not store it, so Starry Night could not be fitted and its placeholder remains. The current tree does store Starry Night and the battery record. The app fits norms only from records carrying a healthy-control flag. The pilot sessions were not stored with that flag, so the numbers above were computed offline with the same routine. A deployment that does not already hold five flagged control batteries still scores against the placeholder table.

Still open: Starry Night norms from new stored runs, test–retest reliability and a reliable-change criterion, an out-of-sample false-positive rate, sensitivity to an induced asymmetry, and any study in stroke survivors. A healthy-volunteer study can show that the measurement is stable in people without neglect. It cannot show that the battery detects neglect. That needs stroke survivors, an established reference, a clinical partner, and ethical approval.

During the event the tests, the model, and this plan were shown to Taryn Zawady, MD, a clinical safety scientist in oncology whose work covers drug safety and clinical trials. She encouraged moving forward and taking the battery to stroke clinicians and to patients. She does not specialize in stroke or neglect, and the conversation was one informal discussion. It is not a clinical validation and it says nothing about accuracy.

## Limitations

- No patient data. Anything said about sensitivity comes from the published literature on the paradigms that were adapted, not from NeuroVision results in stroke survivors.
- The fitted norms come from 20 people, and the placeholder still carries about 30% of the weight in each fit. Starry Night has no fitted norm. The sensitivities, priors, and verdict thresholds are assumptions.
- How the pilot sample was identified rests on the team’s record of the event. The stored sessions carry no healthy-control flag, and no age, handedness, or reading direction.
- Eighteen of 20 healthy Hollow Rings runs were perfect, so that fitted spread rests on two single misses and the placeholder.
- The volunteers were healthy and young. Bisection bias changes with age, so these norms will need age-appropriate replacement before any clinical use.
- Hollow Rings and line bisection need a pointer movement to the stimulus, so arm weakness and visual field loss can affect them. Starry Night depends on a red/green distinction. The target is also larger than the distractors, and colour-vision deficiency has not been tested.
- Screen size, viewing distance, lighting, and distraction vary at home, and the visual angle of the stimuli is not fixed.
- The on-screen report does not yet show the combined posterior.

## In the repository

The live app is a React and Vite site with a small API. Scoring, the contracts, and the evidence model are in `packages/domain`. The other packages are `apps/web` (the battery), `apps/api`, `apps/worker`, `packages/gaze`, and `packages/storage`. Clock drawing, greyscales, and practice-round helpers remain in the scoring library; they are not part of the three-test battery and are not on the live app.
