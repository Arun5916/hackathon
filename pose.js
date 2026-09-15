// pose.js — MediaPipe Pose Engine with Skeleton Drawing & Angle Calculation

import {
  PoseLandmarker,
  FilesetResolver,
  DrawingUtils
} from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/vision_bundle.mjs';

// Landmark indices
const LANDMARKS = {
  NOSE: 0,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
  LEFT_HEEL: 29,
  RIGHT_HEEL: 30,
  LEFT_FOOT: 31,
  RIGHT_FOOT: 32
};

// Custom color palette for skeleton
const COLORS = {
  skeleton: '#00e5a0',
  skeletonGlow: 'rgba(0, 229, 160, 0.3)',
  jointDefault: '#00e5a0',
  jointKnee: '#ffd166',
  jointKneeGlow: 'rgba(255, 209, 102, 0.5)',
  jointHighlight: '#06d6a0',
  good: '#06d6a0',
  warning: '#ffd166',
  danger: '#ef476f',
  text: '#ffffff'
};

// Leg-specific connections for enhanced rendering
const LEG_CONNECTIONS = [
  [LANDMARKS.LEFT_HIP, LANDMARKS.LEFT_KNEE],
  [LANDMARKS.LEFT_KNEE, LANDMARKS.LEFT_ANKLE],
  [LANDMARKS.RIGHT_HIP, LANDMARKS.RIGHT_KNEE],
  [LANDMARKS.RIGHT_KNEE, LANDMARKS.RIGHT_ANKLE],
  [LANDMARKS.LEFT_ANKLE, LANDMARKS.LEFT_HEEL],
  [LANDMARKS.RIGHT_ANKLE, LANDMARKS.RIGHT_HEEL],
  [LANDMARKS.LEFT_HEEL, LANDMARKS.LEFT_FOOT],
  [LANDMARKS.RIGHT_HEEL, LANDMARKS.RIGHT_FOOT],
];

const KNEE_INDICES = [LANDMARKS.LEFT_KNEE, LANDMARKS.RIGHT_KNEE];
const HIP_INDICES = [LANDMARKS.LEFT_HIP, LANDMARKS.RIGHT_HIP];
const ANKLE_INDICES = [LANDMARKS.LEFT_ANKLE, LANDMARKS.RIGHT_ANKLE];

export class PoseEngine {
  constructor() {
    this.poseLandmarker = null;
    this.drawingUtils = null;
    this.video = null;
    this.canvas = null;
    this.ctx = null;
    this.isRunning = false;
    this.lastVideoTime = -1;
    this.animFrameId = null;
    this.onLandmarks = null; // callback for landmarks
    this.stream = null;
    this._initialized = false;
  }

  /**
   * Initialize the MediaPipe PoseLandmarker model
   */
  async init(progressCallback) {
    if (this._initialized) return;

    if (progressCallback) progressCallback('Loading AI vision system...');

    const vision = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm'
    );

    if (progressCallback) progressCallback('Loading pose detection model...');

    this.poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
        delegate: 'GPU'
      },
      runningMode: 'VIDEO',
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5
    });

    this._initialized = true;
    if (progressCallback) progressCallback('Model loaded successfully!');
  }

  /**
   * Setup canvas for drawing
   */
  setupCanvas(videoElement, canvasElement) {
    this.video = videoElement;
    this.canvas = canvasElement;
    this.ctx = canvasElement.getContext('2d');
  }

  /**
   * Start the camera
   */
  async startCamera() {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'user'
        },
        audio: false
      });

      this.video.srcObject = this.stream;

      return new Promise((resolve, reject) => {
        this.video.onloadeddata = () => {
          this.canvas.width = this.video.videoWidth;
          this.canvas.height = this.video.videoHeight;
          this.video.play();
          resolve();
        };
        this.video.onerror = reject;
      });
    } catch (err) {
      console.error('Camera access error:', err);
      throw err;
    }
  }

  /**
   * Stop the camera
   */
  stopCamera() {
    this.stopDetection();
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    if (this.video) {
      this.video.srcObject = null;
    }
  }

  /**
   * Start the detection loop
   */
  startDetection() {
    this.isRunning = true;
    this.lastVideoTime = -1;
    this._detect();
  }

  /**
   * Stop detection loop
   */
  stopDetection() {
    this.isRunning = false;
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    // Clear canvas
    if (this.ctx) {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }

  /**
   * Internal detection loop
   */
  _detect() {
    if (!this.isRunning) return;

    if (this.video.currentTime !== this.lastVideoTime && this.poseLandmarker) {
      this.lastVideoTime = this.video.currentTime;

      const results = this.poseLandmarker.detectForVideo(this.video, performance.now());

      // Clear canvas
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

      if (results.landmarks && results.landmarks.length > 0) {
        const landmarks = results.landmarks[0];
        const worldLandmarks = results.worldLandmarks?.[0];

        // Draw the skeleton
        this._drawSkeleton(landmarks);

        // Notify callback
        if (this.onLandmarks) {
          this.onLandmarks(landmarks, worldLandmarks);
        }
      }
    }

    this.animFrameId = requestAnimationFrame(() => this._detect());
  }

  /**
   * Draw custom skeleton with knee emphasis
   */
  _drawSkeleton(landmarks) {
    const w = this.canvas.width;
    const h = this.canvas.height;

    // Draw all body connections (dimmer)
    this.ctx.save();

    // Draw full body connections using MediaPipe's list
    for (const conn of PoseLandmarker.POSE_CONNECTIONS) {
      const p1 = landmarks[conn.start];
      const p2 = landmarks[conn.end];

      if (p1 && p2 && p1.visibility > 0.4 && p2.visibility > 0.4) {
        const isLeg = LEG_CONNECTIONS.some(
          lc => (lc[0] === conn.start && lc[1] === conn.end) ||
                (lc[0] === conn.end && lc[1] === conn.start)
        );

        this.ctx.beginPath();
        this.ctx.moveTo(p1.x * w, p1.y * h);
        this.ctx.lineTo(p2.x * w, p2.y * h);

        if (isLeg) {
          // Bright leg connections
          this.ctx.strokeStyle = COLORS.skeleton;
          this.ctx.lineWidth = 4;
          this.ctx.shadowColor = COLORS.skeletonGlow;
          this.ctx.shadowBlur = 12;
        } else {
          // Dimmer upper body
          this.ctx.strokeStyle = 'rgba(0, 229, 160, 0.4)';
          this.ctx.lineWidth = 2;
          this.ctx.shadowColor = 'transparent';
          this.ctx.shadowBlur = 0;
        }

        this.ctx.stroke();
      }
    }

    // Draw joints
    landmarks.forEach((pt, idx) => {
      if (pt.visibility < 0.4) return;

      const px = pt.x * w;
      const py = pt.y * h;

      const isKnee = KNEE_INDICES.includes(idx);
      const isKeyLeg = isKnee || HIP_INDICES.includes(idx) || ANKLE_INDICES.includes(idx);

      if (isKnee) {
        // Large glowing knee joints
        this.ctx.shadowColor = COLORS.jointKneeGlow;
        this.ctx.shadowBlur = 20;

        // Outer glow ring
        this.ctx.beginPath();
        this.ctx.arc(px, py, 14, 0, 2 * Math.PI);
        this.ctx.strokeStyle = COLORS.jointKnee;
        this.ctx.lineWidth = 2;
        this.ctx.stroke();

        // Inner filled circle
        this.ctx.beginPath();
        this.ctx.arc(px, py, 8, 0, 2 * Math.PI);
        this.ctx.fillStyle = COLORS.jointKnee;
        this.ctx.fill();

        this.ctx.shadowBlur = 0;
      } else if (isKeyLeg) {
        // Hip and ankle joints
        this.ctx.beginPath();
        this.ctx.arc(px, py, 6, 0, 2 * Math.PI);
        this.ctx.fillStyle = COLORS.jointHighlight;
        this.ctx.shadowColor = COLORS.skeletonGlow;
        this.ctx.shadowBlur = 8;
        this.ctx.fill();
        this.ctx.shadowBlur = 0;
      } else {
        // Other joints (smaller, dimmer)
        this.ctx.beginPath();
        this.ctx.arc(px, py, 3, 0, 2 * Math.PI);
        this.ctx.fillStyle = 'rgba(0, 229, 160, 0.5)';
        this.ctx.fill();
      }
    });

    this.ctx.restore();
  }

  /**
   * Calculate angle at joint B between points A-B-C in degrees
   */
  static calculateAngle(pointA, pointB, pointC) {
    const radians = Math.atan2(pointC.y - pointB.y, pointC.x - pointB.x) -
                    Math.atan2(pointA.y - pointB.y, pointA.x - pointB.x);
    let angle = Math.abs((radians * 180.0) / Math.PI);
    if (angle > 180.0) {
      angle = 360.0 - angle;
    }
    return angle;
  }

  /**
   * Get knee angle for a given side (left or right)
   */
  static getKneeAngle(landmarks, side = 'left') {
    const hip = side === 'left' ? landmarks[LANDMARKS.LEFT_HIP] : landmarks[LANDMARKS.RIGHT_HIP];
    const knee = side === 'left' ? landmarks[LANDMARKS.LEFT_KNEE] : landmarks[LANDMARKS.RIGHT_KNEE];
    const ankle = side === 'left' ? landmarks[LANDMARKS.LEFT_ANKLE] : landmarks[LANDMARKS.RIGHT_ANKLE];

    if (hip.visibility > 0.4 && knee.visibility > 0.4 && ankle.visibility > 0.4) {
      return PoseEngine.calculateAngle(hip, knee, ankle);
    }
    return null;
  }

  /**
   * Get hip angle for a given side
   */
  static getHipAngle(landmarks, side = 'left') {
    const shoulder = side === 'left' ? landmarks[LANDMARKS.LEFT_SHOULDER] : landmarks[LANDMARKS.RIGHT_SHOULDER];
    const hip = side === 'left' ? landmarks[LANDMARKS.LEFT_HIP] : landmarks[LANDMARKS.RIGHT_HIP];
    const knee = side === 'left' ? landmarks[LANDMARKS.LEFT_KNEE] : landmarks[LANDMARKS.RIGHT_KNEE];

    if (shoulder.visibility > 0.4 && hip.visibility > 0.4 && knee.visibility > 0.4) {
      return PoseEngine.calculateAngle(shoulder, hip, knee);
    }
    return null;
  }

  /**
   * Get shoulder angle for a given side (hip-shoulder-elbow)
   */
  static getShoulderAngle(landmarks, side = 'left') {
    const hip = side === 'left' ? landmarks[LANDMARKS.LEFT_HIP] : landmarks[LANDMARKS.RIGHT_HIP];
    const shoulder = side === 'left' ? landmarks[LANDMARKS.LEFT_SHOULDER] : landmarks[LANDMARKS.RIGHT_SHOULDER];
    const elbow = side === 'left' ? landmarks[LANDMARKS.LEFT_ELBOW] : landmarks[LANDMARKS.RIGHT_ELBOW];

    if (hip.visibility > 0.4 && shoulder.visibility > 0.4 && elbow.visibility > 0.4) {
      return PoseEngine.calculateAngle(hip, shoulder, elbow);
    }
    return null;
  }

  /**
   * Get elbow angle for a given side (shoulder-elbow-wrist)
   */
  static getElbowAngle(landmarks, side = 'left') {
    const shoulder = side === 'left' ? landmarks[LANDMARKS.LEFT_SHOULDER] : landmarks[LANDMARKS.RIGHT_SHOULDER];
    const elbow = side === 'left' ? landmarks[LANDMARKS.LEFT_ELBOW] : landmarks[LANDMARKS.RIGHT_ELBOW];
    const wrist = side === 'left' ? landmarks[LANDMARKS.LEFT_WRIST] : landmarks[LANDMARKS.RIGHT_WRIST];

    if (shoulder.visibility > 0.4 && elbow.visibility > 0.4 && wrist.visibility > 0.4) {
      return PoseEngine.calculateAngle(shoulder, elbow, wrist);
    }
    return null;
  }

  /**
   * Evaluate form quality based on target angle range
   * Returns: 'good', 'close', or 'adjust'
   */
  static evaluateForm(currentAngle, targetMin, targetMax) {
    if (currentAngle === null) return 'no-data';

    if (currentAngle >= targetMin && currentAngle <= targetMax) {
      return 'good';
    }

    const margin = 15; // degrees of margin for "close"
    if (currentAngle >= targetMin - margin && currentAngle <= targetMax + margin) {
      return 'close';
    }

    return 'adjust';
  }
}

export { LANDMARKS, COLORS };
