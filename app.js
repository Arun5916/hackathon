// app.js — Main Application Orchestrator

import { PoseEngine } from './pose.js';
import { UIController } from './ui.js';

class App {
  constructor() {
    this.pose = new PoseEngine();
    this.ui = null;
    this.cameraStarted = false;
  }

  async init() {
    // Initialize UI first (doesn't need model)
    this.ui = new UIController();

    // Wire up UI callbacks
    this.ui.onStartExercise = (exercise) => this._handleExerciseStart(exercise);
    this.ui.onStopExercise = () => this._handleExerciseStop();

    // Initialize pose engine (loads model)
    try {
      await this.pose.init((msg) => this.ui.setLoadingText(msg));
    } catch (err) {
      console.error('Failed to init pose engine:', err);
      this.ui.setLoadingText('Error loading model. Please refresh.');
      return;
    }

    // Hide loading screen
    this.ui.hideLoading();

    // Setup start camera button
    this.ui.startCameraBtn.addEventListener('click', () => this._startCamera());

    // Setup exercise controls
    this.ui.startExerciseBtn.addEventListener('click', () => this.ui.toggleExercise());
    this.ui.stopExerciseBtn.addEventListener('click', () => this._stopExercise());

    // Setup pose landmark callback
    this.pose.onLandmarks = (landmarks, worldLandmarks) => {
      this.ui.updatePoseData(landmarks, worldLandmarks, PoseEngine);
    };

    console.log('KneeRehab Pro initialized!');
  }

  async _handleExerciseStart(exercise) {
    // Setup canvas
    const video = document.getElementById('webcam');
    const canvas = document.getElementById('pose-canvas');
    this.pose.setupCanvas(video, canvas);

    if (!this.cameraStarted) {
      this.ui.showCameraPlaceholder(true);
    } else {
      this.ui.showCameraPlaceholder(false);
      this.pose.startDetection();
    }
  }

  _handleExerciseStop() {
    this.pose.stopDetection();
    // Don't stop camera so it's ready for next exercise
  }

  async _startCamera() {
    const btn = this.ui.startCameraBtn;
    btn.textContent = 'Starting camera...';
    btn.disabled = true;

    try {
      const video = document.getElementById('webcam');
      const canvas = document.getElementById('pose-canvas');
      this.pose.setupCanvas(video, canvas);

      await this.pose.startCamera();
      this.cameraStarted = true;

      // Hide placeholder, start detection
      this.ui.showCameraPlaceholder(false);
      this.pose.startDetection();
    } catch (err) {
      console.error('Camera start failed:', err);
      btn.textContent = 'Camera access denied — try again';
      btn.disabled = false;

      if (err.name === 'NotAllowedError') {
        alert('Camera access was denied. Please allow camera access in your browser settings and try again.');
      } else if (err.name === 'NotFoundError') {
        alert('No camera found. Please connect a camera and try again.');
      } else {
        alert('Could not start camera: ' + err.message);
      }
    }
  }

  _stopExercise() {
    this.ui.closeExerciseView();
    this.pose.stopDetection();
  }
}

// Boot the app
const app = new App();
app.init().catch(err => {
  console.error('App initialization failed:', err);
});
