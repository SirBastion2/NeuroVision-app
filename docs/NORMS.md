# Healthy-range norms

Scoring lives in `packages/domain/src/norms.ts` and the shared-θ model in `packages/domain/src/evidence.ts`. Only three tests enter the model: **Starry Night**, **Hollow Rings**, and **line bisection**. Results wording describes deviation from the healthy range or a lean. It does not describe diagnosis.

The means and SDs currently used for those three tests are the Table 2 placeholders from the NeuroVision battery paper (Section 4.5). They are **assumed**, not measured. The model attaches a notice to any result that uses them. Clock, greyscales, gaze, and Hidden scene do not enter the model.

## Table 2 placeholders (used for scoring)

Lateral indices follow Eq. (1): negative means the left side is weaker.

| Test | Lateral index | μ | σ | Source |
| --- | --- | --- | --- | --- |
| Starry Night | Left hit rate − right hit rate | 0 | 0.15 | Assumed symmetric |
| Hollow Rings | Right omission rate − left omission rate | 0 | 0.06 | Assumed symmetric, few omissions |
| Line bisection | Negated mean signed error (% of line length) | +1 | 3 | Small leftward healthy error (pseudoneglect) |

Standard errors follow Eq. (2): adjusted proportions `(x + 1/2) / (n + 1)` for the two rate differences, and the sample SD of the five bisection errors divided by √5. Each index is standardized with Eq. (3), then combined under the shared-θ model (Eqs. (4)–(7)).

These placeholders will be replaced by fitted values once at least five healthy participants are available. Fitting uses Eq. (9) with κ = 8 shrinkage toward the placeholder.

## Tests that do not enter the model

| Measure | Why it is not scored |
| --- | --- |
| Clock check laterality | Not one of the three battery tests in Section 4 |
| Greyscales bias (any reading direction) | Not one of the three battery tests in Section 4 |
| Hidden scene laterality | Demonstration only |
| Gaze time on the left half (webcam) | Not one of the three battery tests in Section 4 |
| Star-cancellation Center of Cancellation | Screening index; not the Hollow Rings lateral index |

Practice suggestion still uses its own 25-point side-gap rule. That is a training heuristic, not a healthy-range claim.

## References for later fitting

PR #22 mapped published healthy-control numbers onto nearby tasks. Those literature values are **not used for scoring**. They remain here as starting points when real NeuroVision samples are fitted with Eq. (9).

| Nearby task | Published healthy-control summary | Why it is not the scoring norm |
| --- | --- | --- |
| Line bisection (20 cm, mm) | Azouvi et al., 2006, *Restorative Neurology and Neuroscience*, n = 457. Mean −0.95 mm, SD 4.15 mm, rightward cutoff 6.5 mm (DOI 10.3233/RNN-2006-354) | Different line set than the five browser lengths; Table 2 is the scoring placeholder |
| Bells cancellation L−R omissions | Azouvi et al., 2006, Table 2, n = 576. Mean 0.05, SD 1.39, cutoff 2 on 15 targets per side | Hollow Rings is a different board; Table 2 uses omission-*rate* difference with σ = 0.06 |
| Greyscales response bias | Friedrich & Elias, 2014, *Culture and Brain*. LTR n = 54, RTL n = 43 | Greyscales does not enter the model |
| BIT star-cancellation CoC | Rorden & Karnath, 2010, *Neuropsychologia*. CoC 0.081 mapped to the BIT cutoff | CoC is not Eq. (1) Hollow Rings |
| Starry Night | Deouell, Sacher & Soroker, 2005 | Patient series; no healthy-control mean/SD for left−right hit rate |

Jewell & McCourt, 2000 (*Neuropsychologia*) is the basis cited in Table 2 for a small healthy leftward bisection error, not a fitted NeuroVision sample.
