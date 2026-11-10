// The coaching library: what each finding means and what to think about to fix it.
//
// Every entry follows the same cue rules (sources in docs/REFERENCE.md):
//   - `cue` is the one thought to carry into a shot: at most five words, about the rim,
//     the ball's flight or the floor where possible, or a simple picture.
//   - `check` is a body-position check for between reps, not during the shot.
//   - `focus` is what to pay attention to in close-range form shooting.
//   - `feel` is how a correct rep feels or looks, so the shooter can self-check.
//   - `watch` names the usual over-correction.
// One cue per rep: the report tells the shooter to carry only the top priority's cue.

import { METRIC_BY_ID } from './specs.js';
import { formatValue, formatRange, formatSpread, lengthFromPct, timingWords } from './format.js';

/**
 * @typedef {Object} CueEntry
 * @property {string} title
 * @property {(c: object) => string} saw   sentence stating the measurement
 * @property {string} cost                 what it does to the shot
 * @property {string} cue
 * @property {string} check
 * @property {string} focus
 * @property {string} feel
 * @property {string} watch
 * @property {string} still                which marked-up frame shows it: dip | set | release | finish | landing
 */

/** @type {Record<string, CueEntry>} */
export const LIBRARY = {
  // ---- Base and load ------------------------------------------------------------------
  'kneeBend.high': {
    title: 'Shallow leg load',
    saw: (c) => `Your knees only bend to ${c.v} at the bottom of the dip. Shooters who get the ball there easily from range load to roughly ${c.range}.`,
    cost: 'With little knee bend the legs add little, so the arm has to supply the distance. Arm-driven shots lose range, flatten out, and change as you tire.',
    cue: 'Push the floor away',
    check: 'Knees bent before the ball arrives.',
    focus: 'Start every form shot from the floor. Feel the push begin in your feet and let the ball ride it up.',
    feel: 'The legs launch the ball and the arm only steers it.',
    watch: 'Sitting into a deep squat slows the shot and costs control. A quick, athletic bend is enough.',
    still: 'dip',
  },
  'kneeBend.low': {
    title: 'Deep, slow load',
    saw: (c) => `Your knees bend to ${c.v} at the bottom of the dip, deeper than the ${c.range} most efficient shooters use.`,
    cost: 'A deep squat takes longer to come out of. The release gets slower and the timing between your legs and your arm gets harder to repeat.',
    cue: 'Quick bounce',
    check: 'Hips stay above knee height.',
    focus: 'Dip and rise in one beat. Count "down-up" at the same pace on every form shot.',
    feel: 'A bounce off the floor, never a sit.',
    watch: 'Going stiff-legged turns the shot into an arm throw.',
    still: 'dip',
  },
  'stanceWidth.low': {
    title: 'Narrow base',
    saw: (c) => `Your feet are ${c.v} your shoulder width apart at the dip. Hip to shoulder width (${c.range}) is the usual range.`,
    cost: 'A narrow base gives you less to balance on, so small sways at take-off turn into left-right misses.',
    cue: 'Same footprints',
    check: 'Feet under your shoulders.',
    focus: 'Set your feet first, then shoot. Look down after each rep and check they landed where they started.',
    feel: 'Head over the middle of your feet, weight even on both.',
    watch: 'Going very wide costs you lift.',
    still: 'dip',
  },
  'stanceWidth.high': {
    title: 'Wide base',
    saw: (c) => `Your feet are ${c.v} your shoulder width apart at the dip. Hip to shoulder width (${c.range}) is the usual range.`,
    cost: 'A very wide base makes it hard to rise straight up, so you lose lift and the jump takes longer.',
    cue: 'Rise to the ceiling',
    check: 'Feet just inside shoulder width.',
    focus: 'Bring your feet in a little and feel how easily you rise straight up.',
    feel: 'Going straight up feels light.',
    watch: 'Too narrow and you lose balance and range.',
    still: 'dip',
  },
  'kneeTrack.low': {
    title: 'Knees cave inward on the load',
    saw: (c) => `At the bottom of the dip your knees are ${c.v} as far apart as your ankles, so they are collapsing inside your feet.`,
    cost: 'Knees that fall inward leak force sideways instead of up and shift your balance as you take off. It also loads the knee joint poorly.',
    cue: 'Spread the floor',
    check: 'Kneecaps over your toes.',
    focus: 'Slow dips facing a mirror or the camera. Watch your kneecaps track over your second toe.',
    feel: 'Pressure through the whole foot, outside edge included.',
    watch: 'Forcing the knees far outside the feet. In line is the goal.',
    still: 'dip',
  },
  'kneeTrack.high': {
    title: 'Knees pushed outside your feet',
    saw: (c) => `At the bottom of the dip your knees are ${c.v} as far apart as your ankles, well outside your feet.`,
    cost: 'Knees bowed outside the feet point the leg drive outward and make the base less stable.',
    cue: 'Knees track the toes',
    check: 'Kneecaps over your toes.',
    focus: 'Slow dips facing a mirror or the camera until the knees and toes line up.',
    feel: 'Weight in the middle of each foot.',
    watch: 'Letting the knees fall inward instead.',
    still: 'dip',
  },

  // ---- Set point -----------------------------------------------------------------------
  'setElbow.low': {
    title: 'Elbow folded tight at the set point',
    saw: (c) => `Your shooting elbow is at ${c.v} when the push starts. Most proficient shooters set between ${c.range}.`,
    cost: 'A tightly folded elbow carries the ball back toward or behind your head. The push gets longer, and the ball tends to be slung forward on a flat line.',
    cue: 'Ball on a tray',
    check: 'Forearm upright under the ball.',
    focus: 'One-hand form shots. Set the ball on your hand like a waiter’s tray in front of your brow and shoot from there.',
    feel: 'The forearm stands up under the ball and the elbow simply follows.',
    watch: 'Chasing an exact angle. Set the hand in the right place and let the elbow fall where it falls.',
    still: 'set',
  },
  'setElbow.high': {
    title: 'Elbow open at the set point',
    saw: (c) => `Your shooting elbow is at ${c.v} when the push starts. Most proficient shooters set between ${c.range}.`,
    cost: 'An open elbow starts the ball out in front of you. That is a long lever, so the shoulder has to push it, the release drops lower, and the shot flattens.',
    cue: 'Ball to your brow',
    check: 'Forearm upright under the ball.',
    focus: 'One-hand form shots. Bring the ball in until your forearm is upright, then shoot.',
    feel: 'The ball sits over your elbow, close to you, before it goes.',
    watch: 'Pulling the ball behind your head.',
    still: 'set',
  },
  'setHeight.low': {
    title: 'Low set point',
    saw: (c) => `Your push starts with your shooting wrist ${c.below} your eye line${c.len ? ` (${c.len})` : ''}.`,
    cost: 'Set-point height is partly style, and a lower set helps you reach from range. Set this low, the ball is pushed up from the chest: it leaves lower, is easier to contest, and the path to release is longer.',
    cue: 'Start it high',
    check: 'Ball at forehead height before the push.',
    focus: 'Form shots that begin with the ball already at your forehead. Let your legs supply the power the lower start used to.',
    feel: 'The ball gets to forehead height before your arm starts to straighten.',
    watch: 'Taking it behind your head, which slings the ball flat. Younger and smaller shooters may need it lower until they are stronger.',
    still: 'set',
  },
  'setHeight.high': {
    title: 'Very high set point',
    saw: (c) => `Your push starts with your shooting wrist ${c.above} your eye line${c.len ? ` (${c.len})` : ''}.`,
    cost: 'A set point this high is hard to block but leaves a short push, so range has to come from the wrist and the jump. That is fine close in and costly from distance.',
    cue: 'Legs carry it',
    check: 'Ball in front of your forehead, never behind it.',
    focus: 'From range, let the ball start a little lower and feel the legs do more.',
    feel: 'The shot reaches the rim without a hard wrist snap.',
    watch: 'Dropping it so low that you push from the chest.',
    still: 'set',
  },
  'elbowFlare.high': {
    title: 'Elbow outside the ball',
    saw: (c) => `Seen from the ${c.viewWord}, your forearm leans ${c.v} inward from the elbow at the set point, so the elbow sits outside your hand. Tucked shooters stay within about ${c.limit}.`,
    cost: 'When the elbow is outside the ball, part of the push goes sideways. That puts sidespin on the ball and spreads your misses left and right.',
    cue: 'Straight line to the rim',
    check: 'Elbow under the middle of the ball.',
    focus: 'Watch the ball’s spin, not your arm. Pure backspin means the push went straight.',
    feel: 'The ball rolls off your index and middle fingers with clean backspin and no sideways wobble.',
    watch: 'Forcing the elbow in with square feet adds shoulder tension. Turning your feet slightly toward your guide side makes room for it.',
    still: 'set',
  },
  'elbowFlare.low': {
    title: 'Elbow pinned inside the ball',
    saw: (c) => `Seen from the ${c.viewWord}, your forearm leans ${c.vAbs} outward from the elbow at the set point, so the elbow is tucked inside your hand.`,
    cost: 'An elbow squeezed in past the ball tightens the shoulder and makes the push arc outward on its way up.',
    cue: 'Loose and straight',
    check: 'Elbow under the middle of the ball.',
    focus: 'Shake the arm out between reps and let the elbow hang naturally under the ball.',
    feel: 'No tension in the shoulder at the set point.',
    watch: 'Letting it swing out wide instead.',
    still: 'set',
  },
  'setLine.low': {
    title: 'Ball set across your face',
    saw: (c) => `At the set point your shooting hand is ${c.lineWords}. A sound line keeps it between your shooting-side eye and your shoulder.`,
    cost: 'A ball that starts on the wrong side of your head has to travel sideways to get to the release. Any sideways travel at release shows up as left-right misses.',
    cue: 'Ball, eye, rim',
    check: 'Ball between your ear and your shoulder.',
    focus: 'Lift the ball straight up your shooting-side line on every form shot.',
    feel: 'The ball climbs one line and never crosses your nose.',
    watch: 'Shooters with an open stance set closer to the face. Judge whether the ball, your eye and the rim line up, not where the ball is.',
    still: 'set',
  },
  'setLine.high': {
    title: 'Ball set wide of your shoulder',
    saw: (c) => `At the set point your shooting hand is ${c.lineWords}. A sound line keeps it between your shooting-side eye and your shoulder.`,
    cost: 'A ball that starts outside your shoulder has to come back in toward the rim line, and that inward push spreads your misses left and right.',
    cue: 'Ball, eye, rim',
    check: 'Ball between your ear and your shoulder.',
    focus: 'Lift the ball straight up your shooting-side line on every form shot.',
    feel: 'The ball, your shooting eye and the rim sit on one line.',
    watch: 'Dragging it across your face instead.',
    still: 'set',
  },
  'setPause.high': {
    title: 'Hitch at the set point',
    saw: (c) => `Your arm waits ${c.v} at the set point before it starts to extend. A brief set is a normal two-motion style; a wait this long is a hitch.`,
    cost: 'While the ball is stopped the leg drive is being spent. By the time the arm goes there is less lift left to use, so the arm pushes alone, range drops and the timing varies from shot to shot.',
    cue: 'The ball never stops',
    check: 'Knees, elbow and wrist bend together.',
    focus: 'Think one word, "smooth", on every form shot. Lift and release in a single motion.',
    feel: 'One continuous lift into the release.',
    watch: 'Rushing. A short, repeatable set is fine if it is the same every time.',
    still: 'set',
  },

  // ---- Release -------------------------------------------------------------------------
  'armExtension.low': {
    title: 'Short-armed release',
    saw: (c) => `Your shooting elbow only straightens to ${c.v}. A full release finishes at ${c.range}.`,
    cost: 'When the elbow stops short, the ball leaves from a different point each time and gets less lift. Shots come out flatter and distance control suffers.',
    cue: 'Reach the high shelf',
    check: 'Elbow finishes above your eyebrow.',
    focus: 'Freeze every form shot at the finish and glance at your elbow. It should be straight and above your eye.',
    feel: 'A long arm at the finish, like reaching into a jar on a high shelf.',
    watch: 'Snapping the wrist hard to make up the distance. That overpowers the shot.',
    still: 'finish',
  },
  'armAngle.low': {
    title: 'Flat release',
    saw: (c) => `At full extension your arm points ${c.v} above horizontal. Shooters with a healthy arc finish at ${c.range}.`,
    cost: 'A flat release sends the ball in on a low arc. The rim is a smaller target from a low angle, and misses come off hard.',
    cue: 'Up and over the rim',
    check: 'Release above your forehead.',
    focus: 'From close range, try to drop every shot just over the front of the rim without touching it.',
    feel: 'The ball comes down into the rim from above.',
    watch: 'Leaning back to add arc. The arc comes from the arm finishing higher.',
    still: 'finish',
  },
  'armAngle.high': {
    title: 'Release going nearly straight up',
    saw: (c) => `At full extension your arm points ${c.v} above horizontal, steeper than the ${c.range} most shooters finish at.`,
    cost: 'A very steep finish sends the ball high but takes away forward drive, so distance has to come from somewhere else and long shots fall short.',
    cue: 'Through the rim',
    check: 'Hand finishes toward the rim, not the ceiling.',
    focus: 'Pick a spot just over the front of the rim and send the ball through it.',
    feel: 'The ball reaches the rim without extra effort.',
    watch: 'Flattening it into a line drive.',
    still: 'finish',
  },
  'reachHeight.low': {
    title: 'Low release point',
    saw: (c) => `At the top of the release your shooting wrist is only ${c.v} of your height above your eyes${c.len ? ` (${c.len})` : ''}.`,
    cost: 'A low release is easier to contest and usually goes with pushing the ball out in front instead of up.',
    cue: 'Finish tall',
    check: 'Ball leaves above your forehead.',
    focus: 'Hold the finish on every form shot with your arm long and your hand high.',
    feel: 'You finish stretched tall with your hand above your head.',
    watch: 'Cocking the ball behind your head to make the release look higher.',
    still: 'finish',
  },
  'releaseVsApex.high': {
    title: 'Releasing on the way down',
    saw: (c) => `The ball leaves about ${c.timing}.`,
    cost: 'Once you are coming down, the lift from your legs is gone and the arm has to supply all the power. From distance that shows up as short, flat shots. Close to the basket a release at the top is normal.',
    cue: 'Shoot on the way up',
    check: 'Ball gone before the peak.',
    focus: 'Small hops close to the rim, with the ball leaving while you are still rising.',
    feel: 'The legs power the shot and the arm only directs it.',
    watch: 'Rushing the arm. The fix is starting the lift earlier, not shooting faster.',
    still: 'release',
  },
  'releaseVsApex.low': {
    title: 'Releasing very early in the jump',
    saw: (c) => `The ball leaves about ${c.timing}.`,
    cost: 'Releasing well before the top is a common way to get range, and it is quick. It gives up release height, so the shot is easier to contest close to a defender.',
    cue: 'Ride the jump up',
    check: 'Ball leaves near the top on mid-range shots.',
    focus: 'On mid-range form shots, let the ball go a beat later and feel how much higher it leaves.',
    feel: 'You are near the top of your jump when the ball goes.',
    watch: 'Hanging until you are falling. Later is only better up to the peak.',
    still: 'release',
  },
  'guideFollow.high': {
    title: 'Guide hand travels with the shot',
    saw: (c) => `Your guide hand rises ${c.v} as far as your shooting hand during the push. A guide hand that comes off cleanly stays close to where it was.`,
    cost: 'A guide hand that keeps moving with the ball can push or twist it. That adds sidespin and pulls shots left or right.',
    cue: 'Guide hand quiet',
    check: 'Guide thumb still points at your head.',
    focus: 'One-hand form shots first. Then add the guide hand as a light touch on the side of the ball.',
    feel: 'The guide hand stays where it was while the ball leaves the other hand.',
    watch: 'Pulling the guide hand away early, which twists the shoulders. Early misses may drift toward your guide side until your legs take over the power.',
    still: 'finish',
  },

  // ---- Follow-through ---------------------------------------------------------------------
  'followHold.low': {
    title: 'Follow-through dropped early',
    saw: (c) => `Your arm stays extended for ${c.v} after the release. Shooters who finish their shots hold it for ${c.range}.`,
    cost: 'Pulling the arm down early usually means the release itself was cut short or hurried. Holding the finish makes the last part of the shot repeatable.',
    cue: 'Hold until it lands',
    check: 'Arm up, wrist relaxed.',
    focus: 'Freeze the finish on every form shot until the ball hits the floor.',
    feel: 'Your hand is still up when the ball reaches the rim.',
    watch: 'Stiffening the wrist to hold the pose. Keep it loose.',
    still: 'finish',
  },
  'finishLine.low': {
    title: 'Follow-through finishes across your body',
    saw: (c) => `Your shooting hand finishes ${c.lineWords}. A straight finish ends over your shooting side.`,
    cost: 'A hand that travels across your body at release drags the ball with it, toward your guide side.',
    cue: 'Finger at the rim',
    check: 'Palm down, index finger pointing at the rim.',
    focus: 'Freeze the finish and see where your index finger points.',
    feel: 'Your hand finishes over your shooting shoulder, pointing at the target.',
    watch: 'Steering the ball with a stiff arm. Keep the wrist relaxed.',
    still: 'finish',
  },
  'finishLine.high': {
    title: 'Follow-through flies outward',
    saw: (c) => `Your shooting hand finishes ${c.lineWords}. A straight finish ends over your shooting side.`,
    cost: 'A hand that swings away from your body at release pushes the ball off line toward your shooting side.',
    cue: 'Finger at the rim',
    check: 'Palm down, index finger pointing at the rim.',
    focus: 'Freeze the finish and see where your index finger points.',
    feel: 'Your hand finishes over your shooting shoulder, pointing at the target.',
    watch: 'Pulling it across your body instead.',
    still: 'finish',
  },

  // ---- Balance -------------------------------------------------------------------------
  'trunkLean.low': {
    title: 'Leaning back at release',
    saw: (c) => `Your trunk leans ${c.vAbs} away from the basket at release. A few degrees either way is normal; proficient shooters are close to upright.`,
    cost: 'When your body is moving away from the target as the ball leaves, you lose distance and the amount you lose changes from shot to shot. Misses come up short.',
    cue: 'Up, not back',
    check: 'Nose over toes at the start.',
    focus: 'Keep your eyes on the rim through the whole shot and rise straight up.',
    feel: 'Your head stays over your feet until the ball is gone.',
    watch: 'A small backward tilt as the feet come forward is a normal style. Only the pronounced lean needs fixing.',
    still: 'release',
  },
  'trunkLean.high': {
    title: 'Leaning forward at release',
    saw: (c) => `Your trunk leans ${c.v} toward the basket at release. Proficient shooters are close to upright.`,
    cost: 'Leaning in adds your body’s forward speed to the ball, and that speed is different on every shot. Distance control suffers and misses run long.',
    cue: 'Rise tall',
    check: 'Shoulders over your feet.',
    focus: 'Jump toward the ceiling on every form shot and finish tall.',
    feel: 'You go straight up and your chest stays over your hips.',
    watch: 'Throwing your shoulders back to compensate.',
    still: 'release',
  },
  'driftForward.low': {
    title: 'Drifting backward',
    saw: (c) => `You land ${c.vAbs} of your height behind where you took off${c.len ? ` (${c.len})` : ''}. Landing level or slightly forward is normal.`,
    cost: 'Drifting away from the basket takes speed off the ball, so shots come up short, and the amount varies from shot to shot.',
    cue: 'Land where you left',
    check: 'Feet come down on or just ahead of the take-off spot.',
    focus: 'Put a mark on the floor and land on it, or just in front of it.',
    feel: 'You come down balanced and could shoot again straight away.',
    watch: 'Lunging forward. A small forward landing is fine.',
    still: 'landing',
  },
  'driftForward.high': {
    title: 'Floating far forward',
    saw: (c) => `You land ${c.v} of your height ahead of where you took off${c.len ? ` (${c.len})` : ''}. Some forward travel is normal and it grows with distance; this is more than most shooters use.`,
    cost: 'A long forward float adds body speed to the ball that is hard to repeat, and it carries you into defenders.',
    cue: 'Shoot from a phone box',
    check: 'Landing within a foot-length of take-off on mid-range shots.',
    focus: 'Rise straight up and come down close to where you started.',
    feel: 'You land balanced, not running after the shot.',
    watch: 'Fading backward instead. From three-point range a longer forward landing is normal.',
    still: 'landing',
  },
  'sideLean.low': {
    title: 'Leaning toward your guide side',
    saw: (c) => `Seen from the ${c.viewWord}, your trunk leans ${c.vAbs} toward your guide side at release.`,
    cost: 'A sideways lean at release moves your shoulder off the line to the rim, and the ball goes with it.',
    cue: 'Tall and centered',
    check: 'Head over the middle of your feet.',
    focus: 'Rise straight up and keep your head still through the release.',
    feel: 'Your head does not move sideways during the shot.',
    watch: 'Tipping the other way.',
    still: 'release',
  },
  'sideLean.high': {
    title: 'Leaning toward your shooting side',
    saw: (c) => `Seen from the ${c.viewWord}, your trunk leans ${c.v} toward your shooting side at release.`,
    cost: 'A sideways lean at release moves your shoulder off the line to the rim, and the ball goes with it.',
    cue: 'Tall and centered',
    check: 'Head over the middle of your feet.',
    focus: 'Rise straight up and keep your head still through the release.',
    feel: 'Your head does not move sideways during the shot.',
    watch: 'Tipping the other way.',
    still: 'release',
  },
  'driftSide.low': {
    title: 'Drifting toward your guide side',
    saw: (c) => `You land ${c.vAbs} of your height toward your guide side of where you took off${c.len ? ` (${c.len})` : ''}.`,
    cost: 'Moving sideways in the air carries the ball off line and changes the shot from one rep to the next.',
    cue: 'Same footprints',
    check: 'Take off and land on one line to the rim.',
    focus: 'Shoot along a line on the floor and land with both feet still on it.',
    feel: 'You land where you left, square to where you started.',
    watch: 'Stiffening up. Balance starts with an even base, not a tense one.',
    still: 'landing',
  },
  'driftSide.high': {
    title: 'Drifting toward your shooting side',
    saw: (c) => `You land ${c.v} of your height toward your shooting side of where you took off${c.len ? ` (${c.len})` : ''}.`,
    cost: 'Moving sideways in the air carries the ball off line and changes the shot from one rep to the next.',
    cue: 'Same footprints',
    check: 'Take off and land on one line to the rim.',
    focus: 'Shoot along a line on the floor and land with both feet still on it.',
    feel: 'You land where you left, square to where you started.',
    watch: 'Stiffening up. Balance starts with an even base, not a tense one.',
    still: 'landing',
  },

  // ---- Consistency -----------------------------------------------------------------------
  'spread.release': {
    title: 'Release position changes from shot to shot',
    saw: (c) => `Your release measurements vary more than a repeatable shot should: ${c.list}.`,
    cost: 'Accuracy follows how repeatable the release is. When the set point, arm angle or finish moves around, the ball leaves at a different speed and direction each time.',
    cue: 'Same finish picture',
    check: 'Pick one spot on the rim and commit to it.',
    focus: 'Keep your eyes on one spot on the rim until the ball arrives. Make ten form shots that all finish in the same picture.',
    feel: 'Every finish looks like the last one.',
    watch: 'Watching your arm during the shot. That adds tension and makes it worse.',
    still: 'finish',
  },
  'spread.timing': {
    title: 'Rhythm changes from shot to shot',
    saw: (c) => `Your timing varies more than a repeatable shot should: ${c.list}.`,
    cost: 'The legs and the arm have to arrive together. When the rhythm changes, the amount of leg power in the shot changes, and so does the distance.',
    cue: 'Down and up',
    check: 'Same count on every shot.',
    focus: 'Say the words out loud at one pace on every form shot.',
    feel: 'Each shot takes the same count.',
    watch: 'An uneven rhythm often means too many thoughts. Cut it to one word.',
    still: 'release',
  },
  'spread.base': {
    title: 'Leg load changes from shot to shot',
    saw: (c) => `Your base varies more than a repeatable shot should: ${c.list}.`,
    cost: 'A different dip or jump each time means a different amount of power each time, and the arm has to make up the difference.',
    cue: 'Same dip, same jump',
    check: 'Feet set the same way before every shot.',
    focus: 'Make every form shot from the same stance and the same depth.',
    feel: 'The start of every shot feels identical.',
    watch: 'Thinking about your knees during the shot. Set the stance, then shoot.',
    still: 'dip',
  },
  'spread.balance': {
    title: 'Balance changes from shot to shot',
    saw: (c) => `Your balance varies more than a repeatable shot should: ${c.list}.`,
    cost: 'When your lean or your landing spot moves around, your body is adding a different push to the ball on every shot.',
    cue: 'Same footprints',
    check: 'Land on the same spot each time.',
    focus: 'Mark your take-off spot and check where you land after every form shot.',
    feel: 'You land in the same place, balanced, every time.',
    watch: 'Freezing your body to stay still. Balance comes from the base.',
    still: 'landing',
  },
};

/** One-line statements for measurements that are already sound. */
export const SOUND = {
  kneeBend: 'Your leg load is in the efficient range.',
  stanceWidth: 'Your base width is sound.',
  kneeTrack: 'Your knees track over your feet.',
  setElbow: 'Your elbow angle at the set point is sound.',
  setHeight: 'Your set-point height is workable.',
  elbowFlare: 'Your elbow is under the ball at the set point.',
  setLine: 'The ball is on your shooting-side line at the set point.',
  setPause: 'The ball keeps moving through the set point.',
  armExtension: 'Your elbow reaches full extension.',
  armAngle: 'Your arm finishes at a healthy angle for arc.',
  reachHeight: 'You release high.',
  releaseVsApex: 'Your release is timed well against your jump.',
  guideFollow: 'Your guide hand stays out of the shot.',
  followHold: 'You hold your follow-through.',
  finishLine: 'Your follow-through finishes straight.',
  trunkLean: 'You are close to upright at release.',
  driftForward: 'Your landing spot is sound.',
  sideLean: 'You stay centered at release.',
  driftSide: 'You take off and land on one line.',
};

function lineWords(ratio) {
  if (!Number.isFinite(ratio)) return '';
  if (ratio < -0.25) return 'well across the middle of your head, on your guide side';
  if (ratio < 0.1) return 'over the middle of your head';
  if (ratio < 0.35) return 'just inside your shooting-side eye';
  if (ratio <= 1.2) return 'over your shooting side';
  if (ratio <= 1.45) return 'just outside your shooting shoulder';
  return 'well outside your shooting shoulder';
}

/**
 * Build the full explanation for a finding.
 * @param {object} finding     from assessSession().findings
 * @param {object} assessment  from assessSession()
 * @param {{ heightCm?: number|null }} [ctx]
 * @returns {object|null}
 */
export function explain(finding, assessment, ctx = {}) {
  const entry = LIBRARY[finding.key];
  if (!entry) return null;
  const c = { heightCm: ctx.heightCm || null };
  let stillView = null;
  if (finding.kind === 'form') {
    const m = assessment.metrics[finding.metric];
    const spec = METRIC_BY_ID[finding.metric];
    c.v = formatValue(spec.id, m.mean);
    c.vAbs = formatValue(spec.id, Math.abs(m.mean));
    c.range = formatRange(spec.id, m.ideal);
    c.limit = formatValue(spec.id, m.ideal[1]);
    c.viewWord = m.views.includes('front') ? 'front' : m.views.includes('back') ? 'back' : 'camera';
    c.len = spec.unit === 'pct' ? lengthFromPct(m.mean, c.heightCm) : '';
    c.below = `${formatValue(spec.id, Math.abs(m.mean))} of your height ${m.mean < 0 ? 'below' : 'above'}`;
    c.above = `${formatValue(spec.id, Math.abs(m.mean))} of your height above`;
    c.timing = timingWords(m.mean, true);
    c.lineWords = lineWords(m.mean);
    stillView = m.views[0];
  } else {
    c.list = finding.metrics
      .map((id) => {
        const m = assessment.metrics[id];
        return `${METRIC_BY_ID[id].label.toLowerCase()} ${formatSpread(id, m.spread.sd)}`;
      })
      .join(', ');
    const first = assessment.metrics[finding.metrics[0]];
    stillView = first ? first.views[0] : null;
  }
  return {
    key: finding.key,
    kind: finding.kind,
    status: finding.status,
    conf: finding.conf,
    metric: finding.metric || null,
    metrics: finding.metrics || (finding.metric ? [finding.metric] : []),
    title: entry.title,
    saw: entry.saw(c),
    cost: entry.cost,
    cue: entry.cue,
    check: entry.check,
    focus: entry.focus,
    feel: entry.feel,
    watch: entry.watch,
    still: entry.still,
    stillView,
  };
}

/**
 * Neutral descriptions of the shooter's style: traits that vary between good
 * shooters and are reported without judgement.
 * @returns {{ id: string, label: string, text: string }[]}
 */
export function styleNotes(assessment, ctx = {}) {
  const out = [];
  const m = assessment.metrics;
  if (m.setPause) {
    const v = m.setPause.mean;
    const text = v < 130
      ? 'One motion. The ball flows from the lift straight into the release without stopping.'
      : v <= 300
        ? `Two motion. You set the ball for about ${Math.round(v / 10) * 10} ms before the push.`
        : `Two motion with a long set of about ${Math.round(v / 10) * 10} ms.`;
    out.push({ id: 'motion', label: 'Motion', text });
  }
  if (m.setHeight) {
    const v = m.setHeight.mean;
    const where = v < -3 ? 'below your eye line' : v <= 3 ? 'at about eye level' : 'above your eye line';
    out.push({ id: 'setHeight', label: 'Set point', text: `You start the push with your wrist ${where}.` });
  }
  if (m.releaseVsApex) {
    out.push({ id: 'timing', label: 'Release timing', text: `The ball leaves ${timingWords(m.releaseVsApex.mean, true)}. Shooters release earlier from long range and later close in.` });
  }
  if (m.tempo) {
    out.push({ id: 'tempo', label: 'Tempo', text: `${formatValue('tempo', m.tempo.mean)} from the bottom of the dip to the release.` });
  }
  if (m.jumpHeight) {
    const cm = m.jumpHeight.mean;
    out.push({ id: 'jump', label: 'Jump', text: `About ${Math.round(cm)} cm (${Math.round(cm / 2.54)} in) off the floor.` });
  }
  if (m.stanceWidth) {
    const v = m.stanceWidth.mean;
    const where = v < 0.85 ? 'narrower than your shoulders' : v <= 1.2 ? 'about shoulder width' : 'wider than your shoulders';
    out.push({ id: 'stance', label: 'Base', text: `Feet ${where} (${formatValue('stanceWidth', v)}).` });
  }
  if (m.driftForward) {
    const v = m.driftForward.mean;
    const len = lengthFromPct(v, ctx.heightCm);
    const where = Math.abs(v) < 1.5 ? 'on your take-off spot' : `${formatValue('driftForward', Math.abs(v))} of your height ${v > 0 ? 'forward' : 'back'}${len ? `, ${len}` : ''}`;
    out.push({ id: 'landing', label: 'Landing', text: `You land ${where}.` });
  }
  return out;
}
