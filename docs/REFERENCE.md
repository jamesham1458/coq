# Where the targets come from

Shot Lab judges each measurement against a range. This file records what each range rests on.

How to read it:

- **Measured** means the numbers come from a study I read directly (the extracted tables are quoted).
- **Reported** means the numbers come from a research summary gathered for this project. The
  planned independent fact-check of those summaries did not complete, so treat the details as
  unverified until someone opens the source.
- **Convention** means widely taught coaching practice with no study behind the exact number.

The ranges are deliberately wide. They mark what proficient shooters share, not one correct form.

## Measurements with a measured link to accuracy

| Measurement | Target (acceptable) | Basis |
|---|---|---|
| Knee bend at the dip | 95–125° (85–136°) | **Measured.** Cabarkapa et al. 2021, free throws: proficient shooters (≥70%) 108.5 ± 9.8°, non-proficient 117.9 ± 16.3°. **Reported:** from three-point range, proficient 94° against 113°. |
| Elbow angle at the set point | 58–88° (50–100°) | **Measured.** Same study: proficient 71.9 ± 5.6°, non-proficient 80.5 ± 6.3°. The groups overlap, so the weight is moderate. |
| Elbow under the ball (forearm off vertical, seen from the front) | up to 15° (up to 26°) | **Measured.** Same study: proficient 7.9 ± 7.2°, non-proficient 19.8 ± 17.6°; within shooters, makes 7.2° against misses 10.7°. No validated cut-off exists. |
| Lean at release | −7 to +5° (−13 to +10°) | **Reported.** Division I shooters stay near vertical at every distance; proficient free-throw shooters lean slightly back (−1.1°), non-proficient slightly forward (+1.9°). Forward lean is flagged sooner than backward lean. **Measured:** Satern found trunk inclination at release did not change with distance. |
| Release timing against the apex | by distance | **Reported.** Elite in-game shots: about 40 ms after the apex from short range, 30 ms before from mid-range, 80 ms before from long range. **Measured:** Satern found men released around the peak of the jump and women before the peak at longer distances. |
| Forward travel in the air | by distance | **Reported.** Euroleague guards travelled 21–32 cm from 3.75 m and 39–49 cm from 6.75 m. Backward travel is what gets flagged. **Measured:** Satern found horizontal displacement grew with distance. |
| Arm angle at full extension | 42–70° (35–78°) | A proxy only. **Measured:** ball release angles average 48–52° (Miller and Bartlett) with 52–55° best for a 4.57 m shot (Hay 1987, cited there); upper-arm angle at release was 123° from hanging in both proficient and non-proficient shooters (Cabarkapa et al. 2021), so this carries a moderate weight and is labelled as an estimate. |

## Traits treated as style

These vary between good shooters and are described in the report without a grade, or flagged only
at an extreme. All **reported**.

- One-motion or two-motion shot. Only a long hitch at the set point is flagged.
- The dip. Not measured as a fault.
- Turned feet and hips. Elite shooters rotate shoulders 15–29° and hips 8–26° at release.
- Set-point height. High and low styles both work; behind the head is the fault.
- Base width. Hip to shoulder width; weak evidence against very narrow.
- Landing forward of the take-off spot. Normal, and larger from distance.
- Sideways travel. Elite guards drift 6–38 cm sideways in games, so only large values are flagged.

## Convention

- Elbow extension of at least 160°.
- Follow-through held about half a second.
- Guide hand staying out of the push. No study isolates it; the reading is labelled low confidence.

## Consistency

Spread thresholds (what counts as tight or loose) are set from the measurement noise of pose
tracking and from the between-shooter spreads above. They are a yardstick for comparing your own
sessions, not a published norm. The report shows the range the true spread likely lies in, from
chi-square bounds on a sample standard deviation: with 5 shots the true spread can be 2.4 times
the measured one; with 10 shots, 1.65 times.

## Cue design

All **reported**.

- External focus (the rim, the ball's flight, the floor) beat internal focus in free-throw
  studies (Zachry et al. 2005; Al-Abood et al. 2002), though the size of the advantage is disputed
  (Chua et al. 2021 against McKay et al. 2024), and a familiar focus can beat a recommended one.
- One analogy can stand in for a list of rules (Lam et al. 2009).
- Cues should be short and few (Landin 1994).

Rules the coaching library follows: one cue per rep, for the top priority only; five words at
most; rim, ball-flight or floor wording first, a picture second, body parts last; body-part
instructions are between-rep checks; every cue is paired with a feel and a visible check; the
over-correction is named.

## Reading video in the browser

All **reported**, then confirmed in Chromium by `test/e2e/readers.mjs`.

- After a seek, Safari on iOS can report `seeked` while the canvas still shows the previous
  frame (WebKit bugs 236755 and 236604). The recommended fix is to arm
  `requestVideoFrameCallback` before the seek and draw inside it.
- WebCodecs with a demuxer avoids playback and seeking altogether. Chrome 94+, Safari 16.4+
  (HEVC from 17.4).
- iPhone slow-motion clips arrive with the slow section baked in, so their timing is stretched.
  Shot Lab warns when flight times are implausibly long.

## Sources

- Cabarkapa D, Fry AC, Carlson KM, Poggio JP, Deane MA. Key kinematic components for optimal
  basketball free throw shooting performance. Central European Journal of Sport Sciences and
  Medicine. 2021;36(4):5–15. doi:10.18276/cej.2021.4-01
- Miller S, Bartlett R. The effects of increased distance on basketball shooting kinematics.
- Satern MN. Kinematic parameters of basketball jump shots projected from varying distances.
- Reported sources, as listed by the research summaries: ojs.ub.uni-konstanz.de/cpa/article/view/2817
  and /1736; PMC8120969; PMC8273237; PMC10436204; PMC12935449; PMC8822900; PubMed 39488500,
  34267591, 35611914, 27442763, 16882627, 12450679; Zachry 2005 (doi:10.1016/j.brainresbull.2005.06.035);
  Al-Abood 2002 (doi:10.1080/026404102317284817); Chua 2021 (doi:10.1037/bul0000335); McKay 2024
  (doi:10.1037/bul0000451); Lam 2009 (doi:10.1080/02640410802448764); Landin 1994
  (doi:10.1080/00336297.1994.10484128).
