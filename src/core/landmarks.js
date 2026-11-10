// MediaPipe Pose landmark indices (33 points) and helpers for picking a body side.

export const LM = Object.freeze({
  NOSE: 0,
  L_EYE_IN: 1, L_EYE: 2, L_EYE_OUT: 3,
  R_EYE_IN: 4, R_EYE: 5, R_EYE_OUT: 6,
  L_EAR: 7, R_EAR: 8,
  MOUTH_L: 9, MOUTH_R: 10,
  L_SHOULDER: 11, R_SHOULDER: 12,
  L_ELBOW: 13, R_ELBOW: 14,
  L_WRIST: 15, R_WRIST: 16,
  L_PINKY: 17, R_PINKY: 18,
  L_INDEX: 19, R_INDEX: 20,
  L_THUMB: 21, R_THUMB: 22,
  L_HIP: 23, R_HIP: 24,
  L_KNEE: 25, R_KNEE: 26,
  L_ANKLE: 27, R_ANKLE: 28,
  L_HEEL: 29, R_HEEL: 30,
  L_TOE: 31, R_TOE: 32,
});

export const N_LANDMARKS = 33;

const LEFT = Object.freeze({
  eye: LM.L_EYE, ear: LM.L_EAR, shoulder: LM.L_SHOULDER, elbow: LM.L_ELBOW, wrist: LM.L_WRIST,
  index: LM.L_INDEX, pinky: LM.L_PINKY, thumb: LM.L_THUMB,
  hip: LM.L_HIP, knee: LM.L_KNEE, ankle: LM.L_ANKLE, heel: LM.L_HEEL, toe: LM.L_TOE,
});

const RIGHT = Object.freeze({
  eye: LM.R_EYE, ear: LM.R_EAR, shoulder: LM.R_SHOULDER, elbow: LM.R_ELBOW, wrist: LM.R_WRIST,
  index: LM.R_INDEX, pinky: LM.R_PINKY, thumb: LM.R_THUMB,
  hip: LM.R_HIP, knee: LM.R_KNEE, ankle: LM.R_ANKLE, heel: LM.R_HEEL, toe: LM.R_TOE,
});

/** Landmark indices for one side of the body. `side` is 'left' or 'right'. */
export function sideOf(side) {
  return side === 'left' ? LEFT : RIGHT;
}

export function otherSide(side) {
  return side === 'left' ? 'right' : 'left';
}

/** Line segments drawn for the skeleton overlay. */
export const SKELETON = Object.freeze([
  [LM.L_SHOULDER, LM.R_SHOULDER],
  [LM.L_SHOULDER, LM.L_ELBOW], [LM.L_ELBOW, LM.L_WRIST],
  [LM.R_SHOULDER, LM.R_ELBOW], [LM.R_ELBOW, LM.R_WRIST],
  [LM.L_SHOULDER, LM.L_HIP], [LM.R_SHOULDER, LM.R_HIP], [LM.L_HIP, LM.R_HIP],
  [LM.L_HIP, LM.L_KNEE], [LM.L_KNEE, LM.L_ANKLE],
  [LM.R_HIP, LM.R_KNEE], [LM.R_KNEE, LM.R_ANKLE],
  [LM.L_ANKLE, LM.L_HEEL], [LM.L_HEEL, LM.L_TOE], [LM.L_ANKLE, LM.L_TOE],
  [LM.R_ANKLE, LM.R_HEEL], [LM.R_HEEL, LM.R_TOE], [LM.R_ANKLE, LM.R_TOE],
  [LM.L_WRIST, LM.L_INDEX], [LM.R_WRIST, LM.R_INDEX],
]);
