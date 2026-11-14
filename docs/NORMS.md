# Healthy-range norms

All numbers used to score or flag a result live in `packages/domain/src/norms.ts`. Scoring compares a recorded value to that module (`z` from mean/SD, or beyond a published cutoff). Results wording describes deviation from the healthy range only. Metrics without a defensible published match are **uncalibrated**: no mean, SD, or cutoff is invented for them.

## Calibrated

| Metric | What is stored | Sample | Source |
| --- | --- | --- | --- |
| Line bisection signed error (% of line length, right of centre positive) | Mean −0.475%, SD 2.075%, cutoff +3.25% (from −0.95 / 4.15 / 6.5 mm on a 20 cm line) | n = 457, adults 20–80+ years (French BEN controls) | Azouvi et al., 2006, *Restorative Neurology and Neuroscience*. [PubMed](https://pubmed.ncbi.nlm.nih.gov/17119296/) DOI 10.3233/RNN-2006-354 |
| Line bisection lateral index (evidence model; negated signed error) | Mean +0.475%, SD 2.075%, cutoff −3.25% | Same sample | Same paper; sign flipped to match “negative = left weaker” |
| Greyscales bias, left-to-right readers (−1…1, positive = darker-left) | Mean +0.360, SD 0.392 (paper −34.6 / 37.67 on −96…+96, sign flipped and /96) | n = 54, young adults (university sample) | Friedrich & Elias, 2014, *Culture and Brain*. [DOI](https://doi.org/10.1007/s40167-014-0019-3) |
| Greyscales bias, right-to-left readers | Mean +0.010, SD 0.438 (paper −0.99 / 42.06, same conversion) | n = 43, young adults (university sample) | Same paper |
| Hollow rings omission laterality (left − right omission rate, percentage points) | Mean 0.33, SD 9.27, cutoff \|13.33\| (from Bells L−R omissions 0.05 / 1.39 / 2 on 15 targets per side) | n = 576, adults 20–80+ years | Azouvi et al., 2006, Bells test Table 2 |
| Star cancellation hit-rate asymmetry (`hitRateRight − hitRateLeft`) | Mean 0.0033, SD 0.0927, cutoff 0.1333 | Same Bells sample | Same mapping, in hit-rate units |
| Star cancellation Center of Cancellation | Cutoff 0.081 (above = outside). No healthy mean/SD | Mapped to the BIT star-cancellation cutoff | Rorden & Karnath, 2010, *Neuropsychologia*. [DOI](https://doi.org/10.1016/j.neuropsychologia.2010.04.018) |

## Uncalibrated

These are stored in the norms module with `calibrated: false` and `source: "uncalibrated"`. Scoring and the UI label them; they do not enter the combined posterior or the 0–1 deviation score.

| Metric | Why uncalibrated |
| --- | --- |
| Clock check laterality (two-clock comparison) | Published clock-drawing cutoffs (including Azouvi CDT) are a different task |
| Starry Night left−right hit rate | Deouell, Sacher & Soroker (2005) is a small patient series with no healthy-control mean/SD for this index |
| Hidden scene laterality | Demonstration only; not scored |
| Greyscales bias, mixed or other reading direction | Friedrich & Elias report LTR and RTL groups only |
| Gaze time on the left half (webcam) | No matching published dwell-laterality mean, SD, or cutoff |

Practice suggestion still uses its own 25-point side-gap rule. That is a training heuristic, not a healthy-range claim.
