// exercises.js — Surgery Rehabilitation Exercise Library with Tracking Config

export const exercises = [
  // ============================================================
  // KNEE EXERCISES
  // ============================================================
  {
    id: 'quad-sets',
    name: 'Quad Sets',
    icon: '🦵',
    region: 'knee',
    description: 'Tighten your thigh muscle and press the back of your knee flat against the surface. This foundational exercise helps restore quadriceps activation after surgery.',
    tutorialVideo: 'istockphoto-2281019362-640_adpp_is.mp4',
    targetSets: 3,
    targetReps: 10,
    holdSeconds: 5,
    targetAngle: { min: 170, max: 180, label: 'Knee Extension' },
    primaryJoint: 'knee',
    tracking: {
      joint: 'knee',
      restAngle: { min: 150, max: 175 },
      activeAngle: { min: 175, max: 180 },
      holdRequired: true,
      holdDuration: 5,
      entryThreshold: 5,
      exitThreshold: 10,
    },
    landmarks: {
      left: { hip: 23, knee: 25, ankle: 27 },
      right: { hip: 24, knee: 26, ankle: 28 }
    },
    tips: 'Focus on feeling tightness in the front of your thigh. Your kneecap should shift slightly upward when contracting correctly.',
    weekPostSurgery: 1
  },
  {
    id: 'straight-leg-raises',
    name: 'Straight Leg Raises',
    icon: '🦿',
    region: 'knee',
    description: 'Strengthen your quadriceps by lifting your straight leg off the surface. Essential for rebuilding thigh strength after knee surgery.',
    tutorialVideo: 'istockphoto-1354203885-640_adpp_is.mp4',
    targetSets: 3,
    targetReps: 10,
    holdSeconds: 3,
    targetAngle: { min: 130, max: 165, label: 'Hip Flexion' },
    primaryJoint: 'hip',
    tracking: {
      joint: 'hip',
      restAngle: { min: 165, max: 180 },
      activeAngle: { min: 130, max: 165 },
      holdRequired: true,
      holdDuration: 3,
      entryThreshold: 5,
      exitThreshold: 10,
    },
    landmarks: {
      left: { shoulder: 11, hip: 23, knee: 25 },
      right: { shoulder: 12, hip: 24, knee: 26 }
    },
    tips: 'Keep your leg completely straight while lifting. If your knee bends, lower the height of the lift.',
    weekPostSurgery: 1
  },
  {
    id: 'heel-slides',
    name: 'Heel Slides',
    icon: '🦶',
    region: 'knee',
    description: 'Gently bend your knee by sliding your heel toward your buttocks. Crucial for regaining knee flexion range of motion.',
    tutorialVideo: 'istockphoto-2281019362-640_adpp_is.mp4',
    targetSets: 3,
    targetReps: 10,
    holdSeconds: 2,
    targetAngle: { min: 70, max: 120, label: 'Knee Flexion' },
    primaryJoint: 'knee',
    tracking: {
      joint: 'knee',
      restAngle: { min: 155, max: 180 },
      activeAngle: { min: 70, max: 130 },
      holdRequired: true,
      holdDuration: 2,
      entryThreshold: 8,
      exitThreshold: 15,
    },
    landmarks: {
      left: { hip: 23, knee: 25, ankle: 27 },
      right: { hip: 24, knee: 26, ankle: 28 }
    },
    tips: 'Use a towel under your heel to reduce friction. Go only as far as pain allows — do not force the bend.',
    weekPostSurgery: 1
  },


  // ============================================================
  // SHOULDER EXERCISES
  // ============================================================
  {
    id: 'pendulum-swings',
    name: 'Pendulum Swings',
    icon: '🔄',
    region: 'shoulder',
    description: 'Gently swing your arm in small circles while leaning forward. This passive exercise promotes blood flow and loosens the shoulder joint without stressing healing tissues.',
    tutorialVideo: 'istockphoto-1354203885-640_adpp_is.mp4',
    targetSets: 3,
    targetReps: 10,
    holdSeconds: 0,
    targetAngle: { min: 10, max: 45, label: 'Shoulder Swing' },
    primaryJoint: 'shoulder',
    tracking: {
      joint: 'shoulder',
      restAngle: { min: 0, max: 20 },
      activeAngle: { min: 20, max: 60 },
      holdRequired: false,
      holdDuration: 0,
      entryThreshold: 8,
      exitThreshold: 10,
    },
    landmarks: {
      left: { hip: 23, shoulder: 11, elbow: 13 },
      right: { hip: 24, shoulder: 12, elbow: 14 }
    },
    tips: 'Keep your arm completely relaxed — let gravity and momentum do the work. Avoid shrugging your shoulder.',
    weekPostSurgery: 1
  },

  {
    id: 'shoulder-flexion',
    name: 'Shoulder Flexion Raise',
    icon: '🙋',
    region: 'shoulder',
    description: 'Raise your arm forward and overhead to build shoulder flexion strength. A key exercise for restoring functional overhead reach.',
    tutorialVideo: 'WhatsApp Video 2026-09-15 at 4.03.50 PM.mp4',
    targetSets: 3,
    targetReps: 10,
    holdSeconds: 3,
    targetAngle: { min: 120, max: 180, label: 'Shoulder Flexion' },
    primaryJoint: 'shoulder',
    tracking: {
      joint: 'shoulder',
      restAngle: { min: 0, max: 30 },
      activeAngle: { min: 120, max: 180 },
      holdRequired: true,
      holdDuration: 3,
      entryThreshold: 10,
      exitThreshold: 20,
    },
    landmarks: {
      left: { hip: 23, shoulder: 11, elbow: 13 },
      right: { hip: 24, shoulder: 12, elbow: 14 }
    },
    tips: 'Keep your core engaged and avoid arching your back. If you feel pain, reduce the height of the raise.',
    weekPostSurgery: 3
  },
  {
    id: 'external-rotation',
    name: 'External Rotation',
    icon: '↩️',
    region: 'shoulder',
    description: 'Rotate your forearm outward with your elbow bent at 90 degrees. Critical for rotator cuff strengthening and restoring external rotation range.',
    tutorialVideo: 'WhatsApp Video 2026-09-15 at 4.03.50 PM.mp4',
    targetSets: 3,
    targetReps: 10,
    holdSeconds: 3,
    targetAngle: { min: 60, max: 100, label: 'Elbow Angle' },
    primaryJoint: 'elbow',
    tracking: {
      joint: 'elbow',
      restAngle: { min: 60, max: 100 },
      activeAngle: { min: 60, max: 100 },
      holdRequired: true,
      holdDuration: 3,
      entryThreshold: 10,
      exitThreshold: 15,
    },
    landmarks: {
      left: { shoulder: 11, elbow: 13, wrist: 15 },
      right: { shoulder: 12, elbow: 14, wrist: 16 }
    },
    tips: 'Keep your elbow glued to your side throughout. Use a rolled towel between your elbow and body for proper positioning.',
    weekPostSurgery: 3
  }
];

export function getFilteredExercises(regionFilter = 'all') {
  return exercises.filter(ex => {
    return regionFilter === 'all'
      || (regionFilter === 'shoulder' && ex.region === 'shoulder')
      || (regionFilter === 'knee' && (ex.region === 'knee' || !ex.region));
  });
}

export function getExerciseById(id) {
  return exercises.find(ex => ex.id === id);
}
