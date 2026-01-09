import trajectoryData from "./trajectory-data.json";

const LOADED_TRAJECTORIES: StoredTrajectory[] =
  trajectoryData as StoredTrajectory[];
const computeTrajectoryFeatures = (): TrajectoryFeatures => {
  const dx: number[] = [];
  const dy: number[] = [];
  const lengths: number[] = [];

  for (const traj of LOADED_TRAJECTORIES) {
    // Handle both array and number dx/dy formats (as in Python code)
    const dxVal = Array.isArray(traj.dx)
      ? Math.sqrt(traj.dx[0] ** 2 + traj.dx[1] ** 2)
      : traj.dx;
    const dyVal = Array.isArray(traj.dy)
      ? Math.sqrt(traj.dy[0] ** 2 + traj.dy[1] ** 2)
      : traj.dy;

    dx.push(dxVal);
    dy.push(dyVal);
    lengths.push(traj.length);
  }

  return { dx, dy, lengths };
};
// Compute features once at module load
const TRAJECTORY_FEATURES = computeTrajectoryFeatures();

export type Point = [number, number]; // [x,y]

export type StoredTrajectory = {
  start: Point;
  end: Point;
  points: Point[];
  dx: number;
  dy: number;
  length: number;
  timing: number[];
};

export type GenerateTrajectoryOptions = {
  /** Number of samples per second (Hz). Default: 60 */
  frequency?: number;
  /** Max jitter in ms to apply to each sample time. Default: 1 */
  frequencyRandomizer?: number;
};

export type TrajectoryResult = {
  /** List of points representing the trajectory */
  points: Point[];
  /** List of timings (in ms) corresponding to each point */
  timings: number[];
};

export type FindNearestOptions = {
  /** Weight for direction similarity (0-1). Default: 0.8 */
  directionWeight?: number;
  /** Weight for length similarity (0-1). Default: 0.2 */
  lengthWeight?: number;
  /** Number of top trajectories to return. Default: 5 */
  topN?: number;
};

export type FindClosestOptions = {
  /** Number of nearest trajectories to consider initially. Default: 5 */
  numNearestToSample?: number;
  /** Number of random perturbations to refine selection. Default: 20 */
  randomSampleIterations?: number;
  /** Power to raise inverse length for selection bias. Default: 2 */
  lengthPreferencePower?: number;
};

export type TrajectoryFeatures = {
  dx: number[];
  dy: number[];
  lengths: number[];
};

/**
 * Generate a realistic human-like mouse trajectory from start to end points.
 *
 * This is the main entry point for trajectory generation, ported from the
 * Python cursory library (https://github.com/Vinyzu/cursory).
 *
 * The algorithm:
 * 1. Find a close matching human trajectory from the pre-recorded database
 * 2. Morph it to fit the target points exactly
 * 3. Add noise (jitter and knots) to avoid fingerprinting
 * 4. Resample with timing jitter for natural timing
 *
 * @param targetStart - Starting point [x, y]
 * @param targetEnd - Ending point [x, y]
 * @param options - Generation options (frequency, timing jitter)
 * @returns Promise resolving to trajectory points and timings
 */
export const generateTrajectory = async (
  targetStart: Point,
  targetEnd: Point,
  options: GenerateTrajectoryOptions = {},
): Promise<TrajectoryResult> => {
  const { frequency = 60, frequencyRandomizer = 1 } = options;

  // Find closest trajectory from database
  const { trajectory, dxTar, dyTar, lenTar } = findClosestTrajectory(
    targetStart,
    targetEnd,
  );

  // Generate the transformed trajectory
  const { points: trajectoryPoints, timings } = findTrajectory(
    trajectory.points,
    trajectory.timing,
    targetStart,
    targetEnd,
    dxTar,
    dyTar,
    lenTar,
  );

  // Normalize timings to start at 0
  const baseTime = timings[0] ?? 0;
  const normalizedTimings = timings.map((t) => t - baseTime);
  const totalTime = normalizedTimings[normalizedTimings.length - 1] ?? 0;

  // Milliseconds between samples
  const baseStep = 1000 / frequency;

  const sampledPoints: Point[] = [];
  const sampledTimings: number[] = [];

  // Sample the trajectory at regular intervals with jitter
  let currentTime = 0;
  while (currentTime <= totalTime) {
    // Apply jitter to the current sampling time
    const jitterScale = Math.max(1.5, frequencyRandomizer);
    let jitter = Math.round(
      gaussianRandom(0, frequencyRandomizer / jitterScale),
    );
    jitter = Math.max(
      -frequencyRandomizer,
      Math.min(frequencyRandomizer, jitter),
    );

    // Clamp the jittered time within the trajectory duration
    const sampleTime = Math.max(0, Math.min(totalTime, currentTime + jitter));

    // Find surrounding keyframes
    let prevIdx = 0;
    for (let i = 0; i < normalizedTimings.length; i++) {
      const timing = normalizedTimings[i];
      if (timing !== undefined && timing <= sampleTime) {
        prevIdx = i;
      } else {
        break;
      }
    }
    const nextIdx = Math.min(prevIdx + 1, normalizedTimings.length - 1);

    const prevPoint = trajectoryPoints[prevIdx];
    const nextPoint = trajectoryPoints[nextIdx];
    const prevTime = normalizedTimings[prevIdx] ?? 0;
    const nextTime = normalizedTimings[nextIdx] ?? 0;

    // Handle edge cases where points might be undefined
    if (!prevPoint || !nextPoint) {
      currentTime += baseStep;
      continue;
    }

    // Interpolation factor
    const alpha =
      nextTime !== prevTime
        ? (sampleTime - prevTime) / (nextTime - prevTime)
        : 0.0;

    // Linear interpolation
    const pointX = prevPoint[0] + alpha * (nextPoint[0] - prevPoint[0]);
    const pointY = prevPoint[1] + alpha * (nextPoint[1] - prevPoint[1]);

    sampledPoints.push([pointX, pointY]);
    sampledTimings.push(sampleTime);

    currentTime += baseStep;
  }

  const trajectoryLength = Math.hypot(
    targetEnd[0] - targetStart[0],
    targetEnd[1] - targetStart[1],
  );

  // Apply knotting to sampled points
  const sampledKnottedPoints = knotTrajectory(
    sampledPoints,
    targetStart,
    targetEnd,
  );

  // Apply jitter
  const sampledJitteredPoints = jitterTrajectory(
    sampledKnottedPoints,
    trajectoryLength,
  );

  // Final morphing to ensure exact start/end
  const sampledMorphedPoints = morphTrajectory(
    sampledJitteredPoints,
    targetStart,
    targetEnd,
    dxTar,
    dyTar,
    lenTar,
  );

  return {
    points: sampledMorphedPoints,
    timings: sampledTimings,
  };
};

/**
 * Find the top N nearest trajectories based on direction and length similarity
 */
const findNearestTrajectory = (
  targetStart: Point,
  targetEnd: Point,
  options: FindNearestOptions = {},
): StoredTrajectory[] => {
  const { directionWeight = 0.8, lengthWeight = 0.2, topN = 5 } = options;

  const dxTar = targetEnd[0] - targetStart[0];
  const dyTar = targetEnd[1] - targetStart[1];
  const lenTar = Math.hypot(dxTar, dyTar);

  // Handle zero-length target vector case
  if (lenTar === 0) {
    // Get top N shortest trajectories
    const indexed = TRAJECTORY_FEATURES.lengths.map((len, i) => ({
      len,
      i,
    }));
    indexed.sort((a, b) => a.len - b.len);
    return indexed
      .slice(0, topN)
      .map((item) => LOADED_TRAJECTORIES[item.i] as StoredTrajectory);
  }

  // Normalize target vector to get direction
  const normDxTar = dxTar / lenTar;
  const normDyTar = dyTar / lenTar;

  // Calculate combined scores for all trajectories
  const scores: Array<{ score: number; index: number }> = [];

  for (let i = 0; i < LOADED_TRAJECTORIES.length; i++) {
    const trajLength = TRAJECTORY_FEATURES.lengths[i] ?? 0;
    const trajDx = TRAJECTORY_FEATURES.dx[i] ?? 0;
    const trajDy = TRAJECTORY_FEATURES.dy[i] ?? 0;

    // Normalize trajectory direction
    let normDx = 0;
    let normDy = 0;
    if (trajLength !== 0) {
      normDx = trajDx / trajLength;
      normDy = trajDy / trajLength;
    }

    // Compute cosine similarity of directions
    const directionSimilarity = normDx * normDxTar + normDy * normDyTar;
    const directionDistance = 1 - directionSimilarity;

    // Calculate normalized length difference
    const lengthDiffRatio = Math.abs(trajLength - lenTar) / Math.max(lenTar, 1);

    // Combined score (lower is better)
    const combinedScore =
      directionWeight * directionDistance + lengthWeight * lengthDiffRatio;

    scores.push({ score: combinedScore, index: i });
  }

  // Sort by score and return top N
  scores.sort((a, b) => a.score - b.score);
  return scores
    .slice(0, topN)
    .map((item) => LOADED_TRAJECTORIES[item.index] as StoredTrajectory);
};

/**
 * Random number generator using Gaussian distribution
 */
const gaussianRandom = (mean: number, stdDev: number): number => {
  // Box-Muller transform
  const u1 = Math.random();
  const u2 = Math.random();
  const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  return z0 * stdDev + mean;
};

/**
 * Find the closest trajectory with preference for shorter trajectories
 */
const findClosestTrajectory = (
  targetStart: Point,
  targetEnd: Point,
  options: FindClosestOptions = {},
): {
  trajectory: StoredTrajectory;
  dxTar: number;
  dyTar: number;
  lenTar: number;
} => {
  const {
    numNearestToSample = 5,
    randomSampleIterations = 20,
    lengthPreferencePower = 2,
  } = options;

  const dxTar = targetEnd[0] - targetStart[0];
  const dyTar = targetEnd[1] - targetStart[1];
  const lenTar = Math.hypot(dxTar, dyTar);

  // Initial selection of top trajectories
  const topTrajectories = findNearestTrajectory(targetStart, targetEnd, {
    topN: numNearestToSample,
  });

  // Iteratively refine by perturbing target end
  for (let i = 0; i < randomSampleIterations; i++) {
    const perturbedEnd: Point = [
      targetEnd[0] + (Math.random() - 0.5) * 2 * lenTar * 0.1,
      targetEnd[1] + (Math.random() - 0.5) * 2 * lenTar * 0.1,
    ];

    const additionalTrajectories = findNearestTrajectory(
      targetStart,
      perturbedEnd,
      { topN: numNearestToSample },
    );
    topTrajectories.push(...additionalTrajectories);
  }

  // Extract lengths and calculate weights
  const topLengths = topTrajectories.map((t) => t.length);
  const epsilon = 1e-10;

  // Calculate inverse length weights (prefer shorter trajectories)
  const inverseLengths = topLengths.map(
    (len) => 1.0 / (len + epsilon) ** lengthPreferencePower,
  );
  const sumInverse = inverseLengths.reduce((a, b) => a + b, 0);
  const weights = inverseLengths.map((w) => w / sumInverse);

  // Weighted random selection
  const random = Math.random();
  let cumulative = 0;
  let selectedIndex = 0;

  for (let i = 0; i < weights.length; i++) {
    cumulative += weights[i] ?? 0;
    if (random <= cumulative) {
      selectedIndex = i;
      break;
    }
  }

  const selectedTrajectory = topTrajectories[selectedIndex];
  if (!selectedTrajectory) {
    throw new Error("No trajectory found");
  }

  return {
    trajectory: selectedTrajectory,
    dxTar,
    dyTar,
    lenTar,
  };
};

/**
 * Morph a trajectory to match target start and end points
 * by scaling, rotating, and translating
 */
const morphTrajectory = (
  points: Point[],
  targetStart: Point,
  targetEnd: Point,
  dxTar: number,
  dyTar: number,
  lenTar: number,
): Point[] => {
  if (points.length === 0) {
    return [];
  }

  const start = points[0] as Point;
  const end = points[points.length - 1] as Point;

  // Calculate original trajectory's displacement and length
  const dxOrig = end[0] - start[0];
  const dyOrig = end[1] - start[1];
  const lenOrig = Math.hypot(dxOrig, dyOrig);

  // Calculate scaling factor
  const scaleFactor = lenOrig !== 0 ? lenTar / lenOrig : 1.0;

  // Calculate rotation angle
  const angleOrig = Math.atan2(dyOrig, dxOrig);
  const angleTar = Math.atan2(dyTar, dxTar);
  const rotationAngle = angleTar - angleOrig;

  // Rotation matrix components
  const cosA = Math.cos(rotationAngle);
  const sinA = Math.sin(rotationAngle);

  // Apply transformation: Scale, Rotate, Translate
  const morphedPoints: Point[] = points.map((point) => {
    // Translate to origin
    let x = point[0] - start[0];
    let y = point[1] - start[1];

    // Scale
    x *= scaleFactor;
    y *= scaleFactor;

    // Rotate
    const rotatedX = x * cosA - y * sinA;
    const rotatedY = x * sinA + y * cosA;

    // Translate to target start
    return [rotatedX + targetStart[0], rotatedY + targetStart[1]] as Point;
  });

  // Ensure exact start and end point matching
  if (morphedPoints.length > 0) {
    morphedPoints[0] = [...targetStart] as Point;
    morphedPoints[morphedPoints.length - 1] = [...targetEnd] as Point;
  }

  return morphedPoints;
};

/**
 * Apply jitter to trajectory points for variation
 */
const jitterTrajectory = (
  points: Point[],
  trajectoryLength: number,
  scale = 0.01,
): Point[] => {
  if (points.length === 0) {
    return [];
  }

  // Scale jitter based on trajectory length
  const lengthScale = Math.min(1.0, trajectoryLength / 400);

  // Calculate distances between consecutive points
  const distances: number[] = new Array(points.length).fill(0);
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1] as Point;
    const curr = points[i] as Point;
    const dist = Math.hypot(curr[0] - prev[0], curr[1] - prev[1]);
    distances[i - 1] = dist;
    distances[i] = dist;
  }

  // Average distances
  const avgDistances = distances.map((d, i) => {
    if (i === 0) return distances[1] ?? d;
    if (i === distances.length - 1) return distances[i - 1] ?? d;
    return ((distances[i - 1] ?? 0) + (distances[i] ?? 0)) / 2;
  });

  // Apply jitter
  const jitteredPoints: Point[] = points.map((point, i) => {
    const avgDist = avgDistances[i] ?? 0;
    const adaptiveScale =
      scale * (avgDist / Math.max(avgDist, 1)) * lengthScale;

    // Alternate direction
    const direction = i % 2 === 0 ? 1 : -1;

    const jitterX = (0.5 + Math.random() * 0.5) * adaptiveScale * direction;
    const jitterY = (0.5 + Math.random() * 0.5) * adaptiveScale * direction;

    return [point[0] + jitterX, point[1] + jitterY] as Point;
  });

  return jitteredPoints;
};

/**
 * Generate a random point biased towards the center of a rectangle
 */
const generateMiddleBiasedPoint = (
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  biasFactor = 2.0,
): Point => {
  const minX = Math.min(x1, x2);
  const maxX = Math.max(x1, x2);
  const minY = Math.min(y1, y2);
  const maxY = Math.max(y1, y2);

  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const width = maxX - minX;
  const height = maxY - minY;

  // Generate Gaussian offsets (Box-Muller transform)
  const u1 = Math.random();
  const u2 = Math.random();
  const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  const z1 = Math.sqrt(-2.0 * Math.log(u1)) * Math.sin(2.0 * Math.PI * u2);

  const offsetX = z0 * (width / (2 * biasFactor));
  const offsetY = z1 * (height / (2 * biasFactor));

  // Clamp to rectangle bounds
  const x = Math.max(minX, Math.min(maxX, centerX + offsetX));
  const y = Math.max(minY, Math.min(maxY, centerY + offsetY));

  return [x, y];
};

/**
 * Apply square root with sign preservation
 */
const sqrtWithSign = (x: number): number => {
  return Math.sign(x) * Math.sqrt(Math.abs(x));
};

/**
 * Introduce "knots" into trajectory by displacing points towards random biased points
 */
const knotTrajectory = (
  points: Point[],
  targetStart: Point,
  targetEnd: Point,
  numKnots = 5,
  knotStrength = 0.15,
): Point[] => {
  if (points.length === 0) {
    return [];
  }

  // Initialize knot offsets
  const knotOffsets: Point[] = points.map(() => [0, 0] as Point);

  for (let k = 0; k < numKnots; k++) {
    // Generate a biased point within the bounding box
    const knot = generateMiddleBiasedPoint(
      targetStart[0],
      targetStart[1],
      targetEnd[0],
      targetEnd[1],
    );

    // Calculate distances from each point to the knot
    const distances: number[] = points.map((point) =>
      Math.hypot(knot[0] - point[0], knot[1] - point[1]),
    );

    const maxDistance = Math.max(...distances);

    // Skip if max distance is too small
    if (maxDistance < 1e-6) {
      continue;
    }

    // Calculate and accumulate offsets
    for (let i = 0; i < points.length; i++) {
      const point = points[i] as Point;
      const distance = distances[i] ?? 0;
      const proximity = 1.0 - distance / maxDistance;
      const scalingFactor = proximity * knotStrength;

      const diffX = knot[0] - point[0];
      const diffY = knot[1] - point[1];

      const offset = knotOffsets[i] as Point;
      offset[0] += diffX * scalingFactor;
      offset[1] += diffY * scalingFactor;
    }
  }

  // Apply square-root scaled displacements
  const knottedPoints: Point[] = points.map((point, i) => {
    const offset = knotOffsets[i] as Point;
    return [
      point[0] + sqrtWithSign(offset[0]),
      point[1] + sqrtWithSign(offset[1]),
    ] as Point;
  });

  return knottedPoints;
};

/**
 * Find a trajectory by selecting, morphing, jittering, and knotting a base trajectory
 */
const findTrajectory = (
  selectedTrajectoryPoints: Point[],
  selectedTrajectoryTimings: number[],
  targetStart: Point,
  targetEnd: Point,
  dxTar: number,
  dyTar: number,
  lenTar: number,
): { points: Point[]; timings: number[] } => {
  // Apply jitter to the trajectory
  const jitteredPoints = jitterTrajectory(selectedTrajectoryPoints, lenTar);

  // Apply knotting
  const knottedPoints = knotTrajectory(jitteredPoints, targetStart, targetEnd);

  // Final morphing to ensure exact fit
  const morphedPoints = morphTrajectory(
    knottedPoints,
    targetStart,
    targetEnd,
    dxTar,
    dyTar,
    lenTar,
  );

  return {
    points: morphedPoints,
    timings: selectedTrajectoryTimings,
  };
};
