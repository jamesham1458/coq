# Shot Lab

Film a basketball jump shot, get the numbers and the fix.

Shot Lab is a single web page. You give it video of your shot; it tracks your body through each
shot, measures the positions and timing that matter, judges them against ranges proficient
shooters share, measures how much each one varies from shot to shot, and tells you what to change
and what to think about while you change it.

Everything runs in the browser. Videos are analysed on the device and never uploaded.

## What it does

- **Quick check.** One shot from any angle. A fast read on mechanics.
- **Full assessment.** A side clip and a front clip (a back clip is optional), ideally 10 shots
  each. Mechanics plus shot-to-shot consistency. Each shot can be marked as a make or a miss.
- **Report.** An overall score, the one cue to take to the court, ranked findings with marked-up
  still frames, every measurement with its target range, style traits described without
  judgement, a frame-by-frame view, and an optional AI-written second opinion.
- **Profiles and progress.** Several shooters, each with their own history and trend charts.

## How it works

1. **Read the video.** Frames are decoded straight from the file with WebCodecs
   ([Mediabunny](https://mediabunny.dev)), so every frame arrives once with its own timestamp.
   Browsers without WebCodecs fall back to stepping a paused `<video>` and confirming each frame
   with `requestVideoFrameCallback`.
2. **Track the body.** [MediaPipe Pose Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker)
   gives 33 landmarks per frame, in image coordinates and in 3D.
3. **Find the shots** (`src/core/shots.js`). There is no ball tracking, so every moment is defined
   from the body:

   | Moment | Definition |
   |---|---|
   | Set point | Start of the final, fast elbow extension |
   | Release (estimated) | Elbow has covered 85% of the way from its set-point angle to its extended angle |
   | Full extension | Elbow within 3° of the angle it holds after extending |
   | Dip | Deepest knee bend before the release |
   | Take-off / landing | Every heel and toe point clears / returns to the level it stood on during the dip |
   | Apex | Vertex of a parabola fitted to hip height during flight |

4. **Measure** (`src/core/metrics.js`). Angles in the plane of the shot come from the side view;
   everything across the body comes from the front or back view; heights and timing come from any
   view. Joint angles from a non-side view use the 3D landmarks and are labelled as estimates.
5. **Judge** (`src/core/specs.js`, `src/core/assess.js`). Each measurement has a target range and
   a wider acceptable range. Release timing and forward travel are judged against shot distance.
   Consistency is the standard deviation across shots, reported with the range the true value
   likely lies in.
6. **Coach** (`src/core/cues.js`). Each finding carries what was measured, what it costs, one cue
   of at most five words, a between-rep check, a form-shooting focus, what a good rep feels like,
   and the over-correction to avoid.

Sources for the target ranges and cue rules are in [docs/REFERENCE.md](docs/REFERENCE.md).

## Limits

- No ball tracking. Release moment, release height and arm angle are estimates from the body.
- Fingers and gaze are outside what body tracking resolves.
- At 30 frames per second one frame is 33 ms; smaller timing differences are noise. Film at 60.
- The tracker follows one person. Keep other people out of the picture.
- Targets describe what proficient shooters have in common. They are not one correct form.

## Run it

```sh
npm install
npm run fetch-model   # downloads the pose model (9 MB) into vendor/models
npm run build         # writes build/site and build/artifact
npm run serve         # http://127.0.0.1:4173/
```

`build/site` is a complete static site for any host. `build/artifact` holds the same page as a
fragment plus the engine files, for publishing as a Claude artifact:

- `shot-lab.html`
- `engine/vision_wasm_internal.js`, `engine/vision_wasm_internal.wasm`
- `engine/pose_landmarker_full.txt` (the model as base64 text, since hosts for pages like this
  serve scripts, data and media but not arbitrary binary files)

Inside the Claude viewer the page uses three capabilities, all optional: `db` and `user` to keep
profiles and history in the signed-in person's private storage, and `sample` (with images) for the
AI write-up. Anywhere else, history falls back to the browser's local storage.

## Test it

```sh
npm test                      # unit tests, no browser needed
npm run test:browser          # both video readers in headless Chromium (needs Playwright and ffmpeg)
```

The unit tests run the whole analysis against a synthetic shooter (`src/core/synth.js`): a small
kinematic model of a jump shot whose true set-point angle, release time, drift and so on are
known, filmed by a virtual camera from any angle. A shooter built with an 82° set-point elbow has
to be measured at about 82°.

## Layout

```
src/core/     analysis: landmarks, filtering, shot detection, measurements, targets, scoring, cues
src/engine/   pose engine wrapper and the two video readers
src/app/      storage, AI write-up, pipeline, charts, still-frame overlays, screens
scripts/      build, local server, model download
test/         unit tests and the browser check
docs/         sources for the targets
```

## Third-party software

- MediaPipe Tasks Vision and the Pose Landmarker model, Apache-2.0
- Mediabunny, MPL-2.0
- Barlow Condensed, IBM Plex Sans and IBM Plex Mono, SIL Open Font License, loaded from Google Fonts
