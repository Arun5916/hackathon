// ui.js — UI Controller with Advanced Rep Tracking System
import { exercises, getFilteredExercises, getExerciseById } from './exercises.js';

/**
 * Simple beep sound using Web Audio API — no external files needed
 */
class SoundFX {
  constructor() {
    this.ctx = null;
  }

  _ensureContext() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
  }

  /** Short success beep for rep completion */
  repComplete() {
    this._ensureContext();
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.frequency.value = 880;   // A5 note
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.3, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.2);

    osc.start(this.ctx.currentTime);
    osc.stop(this.ctx.currentTime + 0.2);
  }

  /** Two-tone success for set completion */
  setComplete() {
    this._ensureContext();
    const t = this.ctx.currentTime;
    [660, 880, 1100].forEach((freq, i) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.frequency.value = freq;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.25, t + i * 0.15);
      gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.15 + 0.25);
      osc.start(t + i * 0.15);
      osc.stop(t + i * 0.15 + 0.25);
    });
  }

  /** Short tick for hold countdown */
  holdTick() {
    this._ensureContext();
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.frequency.value = 440;
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.1, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.08);
    osc.start(this.ctx.currentTime);
    osc.stop(this.ctx.currentTime + 0.08);
  }
}

/**
 * Rep Tracking State Machine
 * States: IDLE → REST → ACTIVE → HOLDING → RETURNING → REST (rep counted)
 */
const TrackState = {
  IDLE: 'idle',
  REST: 'rest',           // In rest position, waiting for movement
  MOVING: 'moving',       // Moving from rest toward active position
  ACTIVE: 'active',       // Reached active position
  HOLDING: 'holding',     // Holding at active position (for hold exercises)
  RETURNING: 'returning', // Moving back from active to rest
};

export class UIController {
  constructor() {
    this.regionFilter = 'knee';

    // Exercise state
    this.currentExercise = null;
    this.isExerciseActive = false;
    this.currentReps = 0;
    this.currentSet = 1;
    this.exerciseTimer = null;
    this.exerciseTime = 0;

    // Advanced rep tracking
    this._trackState = TrackState.IDLE;
    this._angleBuffer = [];       // Rolling buffer for smoothing (8 frames)
    this._holdStartTime = 0;      // When the hold started
    this._holdTimerInterval = null;
    this._holdElapsed = 0;
    this._lastAngle = null;
    this._stateEntryTime = 0;     // When current state was entered
    this._minAngleInRep = 180;    // Track minimum angle in current rep
    this._maxAngleInRep = 0;      // Track maximum angle in current rep

    // Sound effects
    this.sound = new SoundFX();

    // Callbacks
    this.onStartExercise = null;
    this.onStopExercise = null;

    this._cacheElements();
    this._initRegionTabs();
    this._initDailyProgress();
    this.renderExerciseCards();
  }

  _cacheElements() {
    this.exerciseGrid = document.getElementById('exercise-grid');
    this.filterBar = document.getElementById('filter-bar');
    this.exerciseView = document.getElementById('exercise-view');
    this.exerciseViewTitle = document.getElementById('exercise-view-title');
    this.exerciseInfoIcon = document.getElementById('exercise-info-icon');
    this.exerciseInfoName = document.getElementById('exercise-info-name');
    this.exerciseInfoDesc = document.getElementById('exercise-info-desc');

    this.instructionsList = document.getElementById('instructions-list');
    this.tipBox = document.getElementById('tip-text');
    this.backBtn = document.getElementById('back-btn');
    this.statSets = document.getElementById('stat-sets');
    this.statReps = document.getElementById('stat-reps');
    this.statHold = document.getElementById('stat-hold');
    this.angleValue = document.getElementById('angle-value');
    this.angleTarget = document.getElementById('angle-target');
    this.angleLabel = document.getElementById('angle-label');
    this.repValue = document.getElementById('rep-value');
    this.repTotal = document.getElementById('rep-total');
    this.formFeedback = document.getElementById('form-feedback');
    this.angleDisplay = document.getElementById('angle-display');
    this.repCounter = document.getElementById('rep-counter');
    this.startExerciseBtn = document.getElementById('start-exercise-btn');
    this.stopExerciseBtn = document.getElementById('stop-exercise-btn');
    this.timerValue = document.getElementById('timer-value');
    this.progressFill = document.getElementById('progress-fill');
    this.progressLabel = document.getElementById('progress-label');
    this.progressValue = document.getElementById('progress-value-text');
    this.cameraPlaceholder = document.getElementById('camera-placeholder');
    this.startCameraBtn = document.getElementById('start-camera-btn');
    this.librarySection = document.getElementById('library-section');
    this.holdIndicator = document.getElementById('hold-indicator');
    this.holdCountdown = document.getElementById('hold-countdown');
    this.holdBar = document.getElementById('hold-bar-fill');
    
    // Daily progress
    this.dailyProgressCount = document.getElementById('daily-progress-count');
    this.dailyProgressFill = document.getElementById('daily-progress-fill');

    this.backBtn.addEventListener('click', () => this.closeExerciseView());

  }

  _initDailyProgress() {
    const completed = this.getCompletedExercises();
    const total = exercises.length;
    const count = completed.length;
    
    if (this.dailyProgressCount) {
      this.dailyProgressCount.textContent = `${count} / ${total} Completed`;
    }
    if (this.dailyProgressFill) {
      const pct = Math.min(100, Math.round((count / total) * 100));
      this.dailyProgressFill.style.width = `${pct}%`;
    }
  }

  getCompletedExercises() {
    const today = new Date().toISOString().split('T')[0];
    const key = `kneerehab_completed_${today}`;
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : [];
  }

  markExerciseComplete(exerciseId) {
    const today = new Date().toISOString().split('T')[0];
    const key = `kneerehab_completed_${today}`;
    let completed = this.getCompletedExercises();
    
    if (!completed.includes(exerciseId)) {
      completed.push(exerciseId);
      localStorage.setItem(key, JSON.stringify(completed));
      this._initDailyProgress();
      this.renderExerciseCards(); // Re-render to show tick mark
    }
  }

  _initRegionTabs() {
    const tabsContainer = document.getElementById('body-region-tabs');
    if (!tabsContainer) return;

    tabsContainer.addEventListener('click', (e) => {
      const tab = e.target.closest('.region-tab');
      if (!tab) return;
      tabsContainer.querySelectorAll('.region-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      this.regionFilter = tab.dataset.region;
      this.renderExerciseCards();
    });
  }



  renderExerciseCards() {
    const filtered = getFilteredExercises(this.regionFilter);

    if (filtered.length === 0) {
      this.exerciseGrid.innerHTML = `
        <div class="no-exercises">
          <div class="no-exercises-icon">🔍</div>
          <h3>No exercises found</h3>
          <p>Try adjusting your filters to see more exercises.</p>
        </div>
      `;
      return;
    }

    const completedList = this.getCompletedExercises();

    this.exerciseGrid.innerHTML = filtered.map((ex, idx) => {
      const isCompleted = completedList.includes(ex.id);
      const completedBadge = isCompleted ? '<span class="badge badge-completed">✅ Done Today</span>' : '';
      const holdMeta = ex.holdSeconds > 0
        ? '<div class="meta-item"><span>⏱️</span><span class="meta-value">' + ex.holdSeconds + 's hold</span></div>'
        : '';
      return '<div class="exercise-card" data-exercise-id="' + ex.id + '" style="animation-delay: ' + (idx * 0.05) + 's">'
        + '<div class="card-header"><div class="card-icon">' + ex.icon + '</div>'
        + '<div class="card-badges">' + completedBadge
        + '</div></div>'
        + '<h3 class="card-title">' + ex.name + '</h3>'
        + '<p class="card-description">' + ex.description + '</p>'
        + '<div class="card-meta"><div class="meta-item"><span>🔄</span><span class="meta-value">'
        + ex.targetSets + ' sets</span></div><div class="meta-item"><span>💪</span><span class="meta-value">'
        + ex.targetReps + ' reps</span></div>' + holdMeta + '</div>'
        + '<button class="card-start-btn" data-exercise-id="' + ex.id + '"><span>📷</span> Start with Camera</button>'
        + '</div>';
    }).join('');

    this.exerciseGrid.querySelectorAll('.exercise-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.card-start-btn')) return;
        this.openExerciseView(card.dataset.exerciseId);
      });
    });

    this.exerciseGrid.querySelectorAll('.card-start-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.openExerciseView(btn.dataset.exerciseId);
      });
    });
  }

  openExerciseView(exerciseId) {
    const exercise = getExerciseById(exerciseId);
    if (!exercise) return;

    this.currentExercise = exercise;
    this.currentReps = 0;
    this.currentSet = 1;
    this._resetTracking();


    // Update UI
    this.exerciseViewTitle.textContent = exercise.name;
    this.exerciseInfoIcon.textContent = exercise.icon;
    this.exerciseInfoName.textContent = exercise.name;
    this.exerciseInfoDesc.textContent = exercise.description;
    this.statSets.textContent = exercise.targetSets;
    this.statReps.textContent = exercise.targetReps;
    this.statHold.textContent = exercise.holdSeconds > 0 ? `${exercise.holdSeconds}s` : '—';

    if (exercise.tutorialVideo) {
      this.instructionsList.innerHTML = `<video src="${exercise.tutorialVideo}" controls autoplay loop style="width: 100%; border-radius: 8px;"></video>`;
    } else {
      this.instructionsList.innerHTML = (exercise.instructions || [])
        .map(inst => `<li>${inst}</li>`).join('');
    }
    this.tipBox.textContent = exercise.tips;

    // Angle display
    const t = exercise.tracking;
    this.angleLabel.textContent = exercise.targetAngle.label;
    this.angleTarget.textContent = `Target: ${t.activeAngle.min}° — ${t.activeAngle.max}°`;

    // Reset displays
    this.repValue.textContent = '0';
    this.repTotal.textContent = `/ ${exercise.targetReps}`;
    this.angleValue.textContent = '—';
    this.angleValue.className = 'angle-value';
    this.formFeedback.textContent = 'Position yourself in the camera view';
    this.formFeedback.className = 'form-feedback';
    this.updateProgress(0);
    this.exerciseTime = 0;
    this.timerValue.textContent = '00:00';
    this.startExerciseBtn.innerHTML = '<span>▶️</span> Start Exercise';
    this.isExerciseActive = false;

    // Hide hold indicator
    if (this.holdIndicator) this.holdIndicator.style.display = 'none';

    this.librarySection.style.display = 'none';
    this.exerciseView.classList.add('active');

    if (this.onStartExercise) this.onStartExercise(exercise);
  }


  closeExerciseView() {
    this.exerciseView.classList.remove('active');
    this.librarySection.style.display = '';
    this.isExerciseActive = false;
    this.currentExercise = null;
    this._stopAllTimers();
    if (this.onStopExercise) this.onStopExercise();
  }

  toggleExercise() {
    this.isExerciseActive = !this.isExerciseActive;
    if (this.isExerciseActive) {
      this.startExerciseBtn.innerHTML = '<span>⏸️</span> Pause Exercise';
      this._startExerciseTimer();
      this._trackState = TrackState.IDLE;
    } else {
      this.startExerciseBtn.innerHTML = '<span>▶️</span> Resume Exercise';
      this._stopAllTimers();
      this._startExerciseTimer(); // keep main timer but pause tracking
      if (this.holdIndicator) this.holdIndicator.style.display = 'none';
    }
  }

  _startExerciseTimer() {
    if (this.exerciseTimer) clearInterval(this.exerciseTimer);
    this.exerciseTimer = setInterval(() => {
      this.exerciseTime++;
      const mins = Math.floor(this.exerciseTime / 60).toString().padStart(2, '0');
      const secs = (this.exerciseTime % 60).toString().padStart(2, '0');
      this.timerValue.textContent = `${mins}:${secs}`;
    }, 1000);
  }

  _stopAllTimers() {
    if (this.exerciseTimer) { clearInterval(this.exerciseTimer); this.exerciseTimer = null; }
    if (this._holdTimerInterval) { clearInterval(this._holdTimerInterval); this._holdTimerInterval = null; }
  }

  _resetTracking() {
    this._trackState = TrackState.IDLE;
    this._angleBuffer = [];
    this._holdStartTime = 0;
    this._holdElapsed = 0;
    this._lastAngle = null;
    this._stateEntryTime = 0;
    this._minAngleInRep = 180;
    this._maxAngleInRep = 0;
    if (this._holdTimerInterval) { clearInterval(this._holdTimerInterval); this._holdTimerInterval = null; }
  }

  // ============================================================
  // CORE: Pose data processing + rep tracking
  // ============================================================

  updatePoseData(landmarks, worldLandmarks, PoseEngine) {
    if (!this.currentExercise || !this.isExerciseActive) return;

    const exercise = this.currentExercise;
    const tracking = exercise.tracking;
    let angle = null;

    // Calculate joint angle based on tracking config
    const jointType = tracking.joint;
    if (jointType === 'knee') {
      const leftAngle = PoseEngine.getKneeAngle(landmarks, 'left');
      const rightAngle = PoseEngine.getKneeAngle(landmarks, 'right');
      if (leftAngle !== null && rightAngle !== null) {
        angle = (leftAngle + rightAngle) / 2;
      } else {
        angle = leftAngle ?? rightAngle;
      }
    } else if (jointType === 'hip') {
      const leftAngle = PoseEngine.getHipAngle(landmarks, 'left');
      const rightAngle = PoseEngine.getHipAngle(landmarks, 'right');
      if (leftAngle !== null && rightAngle !== null) {
        angle = (leftAngle + rightAngle) / 2;
      } else {
        angle = leftAngle ?? rightAngle;
      }
    } else if (jointType === 'shoulder') {
      const leftAngle = PoseEngine.getShoulderAngle(landmarks, 'left');
      const rightAngle = PoseEngine.getShoulderAngle(landmarks, 'right');
      if (leftAngle !== null && rightAngle !== null) {
        angle = (leftAngle + rightAngle) / 2;
      } else {
        angle = leftAngle ?? rightAngle;
      }
    } else if (jointType === 'elbow') {
      const leftAngle = PoseEngine.getElbowAngle(landmarks, 'left');
      const rightAngle = PoseEngine.getElbowAngle(landmarks, 'right');
      if (leftAngle !== null && rightAngle !== null) {
        angle = (leftAngle + rightAngle) / 2;
      } else {
        angle = leftAngle ?? rightAngle;
      }
    }

    if (angle === null) return;

    // Smooth the angle (8-frame rolling average for stability)
    this._angleBuffer.push(angle);
    if (this._angleBuffer.length > 8) this._angleBuffer.shift();
    const smoothed = this._angleBuffer.reduce((a, b) => a + b, 0) / this._angleBuffer.length;
    this._lastAngle = smoothed;

    // Update angle display
    this.angleValue.textContent = `${Math.round(smoothed)}°`;

    // Track min/max for range-of-motion feedback
    this._minAngleInRep = Math.min(this._minAngleInRep, smoothed);
    this._maxAngleInRep = Math.max(this._maxAngleInRep, smoothed);

    // Run state machine
    this._runStateMachine(smoothed, tracking);

    // Update form feedback based on current state
    this._updateFeedback(smoothed, tracking);
  }

  /**
   * Main rep tracking state machine
   */
  _runStateMachine(angle, tracking) {
    const now = Date.now();
    const inRest = this._isInRange(angle, tracking.restAngle, tracking.entryThreshold);
    const inActive = this._isInRange(angle, tracking.activeAngle, tracking.entryThreshold);

    switch (this._trackState) {
      case TrackState.IDLE:
        // First detection — determine starting position
        if (inRest) {
          this._transitionTo(TrackState.REST);
        } else if (inActive) {
          // Already in active position, go to active
          this._transitionTo(TrackState.ACTIVE);
        }
        break;

      case TrackState.REST:
        // Waiting at rest position for user to start moving
        if (inActive) {
          // Jumped straight to active (fast movement)
          this._transitionTo(TrackState.ACTIVE);
        } else if (!inRest) {
          // Started moving out of rest
          this._transitionTo(TrackState.MOVING);
        }
        break;

      case TrackState.MOVING:
        // Moving from rest toward active position
        if (inActive) {
          this._transitionTo(TrackState.ACTIVE);
        } else if (inRest) {
          // Went back to rest without reaching active — no rep
          this._transitionTo(TrackState.REST);
        }
        break;

      case TrackState.ACTIVE:
        if (tracking.holdRequired && tracking.holdDuration > 0) {
          // Need to hold — start hold timer
          this._startHoldTimer(tracking.holdDuration);
          this._transitionTo(TrackState.HOLDING);
        } else {
          // No hold required — immediate transition to returning
          this._transitionTo(TrackState.RETURNING);
        }
        break;

      case TrackState.HOLDING:
        if (!inActive) {
          // Left active position during hold — reset hold
          this._cancelHoldTimer();
          // Check if returned to rest
          if (inRest) {
            // Partially completed — go back to rest (no rep counted)
            this.formFeedback.textContent = '⚠️ Hold longer next time!';
            this.formFeedback.className = 'form-feedback adjust';
            this._transitionTo(TrackState.REST);
          } else {
            this._transitionTo(TrackState.MOVING);
          }
        }
        // Hold timer completion is handled by _onHoldComplete
        break;

      case TrackState.RETURNING:
        if (inRest) {
          // Returned to rest — REP COMPLETE!
          this._countRep();
          this._transitionTo(TrackState.REST);
        } else if (inActive) {
          // Went back to active — might be adjusting
          if (tracking.holdRequired && tracking.holdDuration > 0) {
            this._startHoldTimer(tracking.holdDuration);
            this._transitionTo(TrackState.HOLDING);
          }
        }
        break;
    }
  }

  _transitionTo(newState) {
    this._trackState = newState;
    this._stateEntryTime = Date.now();
    this._minAngleInRep = this._lastAngle || 180;
    this._maxAngleInRep = this._lastAngle || 0;
  }

  _isInRange(angle, range, threshold = 0) {
    return angle >= (range.min - threshold) && angle <= (range.max + threshold);
  }

  // ============================================================
  // Hold Timer System
  // ============================================================

  _startHoldTimer(duration) {
    this._cancelHoldTimer();
    this._holdStartTime = Date.now();
    this._holdElapsed = 0;

    // Show hold indicator
    if (this.holdIndicator) {
      this.holdIndicator.style.display = 'block';
      this.holdCountdown.textContent = duration;
      this.holdBar.style.width = '0%';
    }

    this._holdTimerInterval = setInterval(() => {
      this._holdElapsed = (Date.now() - this._holdStartTime) / 1000;
      const remaining = Math.max(0, duration - this._holdElapsed);
      const progress = Math.min(100, (this._holdElapsed / duration) * 100);

      // Update hold UI
      if (this.holdCountdown) {
        this.holdCountdown.textContent = Math.ceil(remaining);
      }
      if (this.holdBar) {
        this.holdBar.style.width = `${progress}%`;
      }

      // Tick sound each second
      if (Math.floor(this._holdElapsed) > Math.floor(this._holdElapsed - 0.1)) {
        this.sound.holdTick();
      }

      // Update feedback during hold
      this.formFeedback.textContent = `⏱️ Hold — ${Math.ceil(remaining)}s remaining`;
      this.formFeedback.className = 'form-feedback good';

      // Hold complete
      if (this._holdElapsed >= duration) {
        this._onHoldComplete();
      }
    }, 100);
  }

  _onHoldComplete() {
    this._cancelHoldTimer();

    // Hide hold indicator
    if (this.holdIndicator) this.holdIndicator.style.display = 'none';

    this.formFeedback.textContent = '✅ Hold complete! Return to starting position';
    this.formFeedback.className = 'form-feedback good';

    this._transitionTo(TrackState.RETURNING);
  }

  _cancelHoldTimer() {
    if (this._holdTimerInterval) {
      clearInterval(this._holdTimerInterval);
      this._holdTimerInterval = null;
    }
    if (this.holdIndicator) this.holdIndicator.style.display = 'none';
  }

  // ============================================================
  // Rep Counting & Progress
  // ============================================================

  _countRep() {
    this.currentReps++;
    this.repValue.textContent = this.currentReps.toString();

    // Sound effect
    this.sound.repComplete();

    // Flash the rep counter
    this.repCounter.classList.add('rep-flash');
    setTimeout(() => this.repCounter.classList.remove('rep-flash'), 500);

    // Flash feedback
    this.formFeedback.textContent = `✅ Rep ${this.currentReps} complete!`;
    this.formFeedback.className = 'form-feedback good';

    const exercise = this.currentExercise;

    // Check set completion
    if (this.currentReps >= exercise.targetReps) {
      if (this.currentSet < exercise.targetSets) {
        // Next set
        this.currentSet++;
        this.currentReps = 0;
        this.repValue.textContent = '0';
        this.sound.setComplete();
        this.formFeedback.textContent = `🎉 Set ${this.currentSet - 1} done! Rest, then start set ${this.currentSet}`;
        this.formFeedback.className = 'form-feedback good';
      } else {
        // All sets complete!
        this.sound.setComplete();
        this.formFeedback.textContent = '🏆 All sets complete! Amazing work!';
        this.formFeedback.className = 'form-feedback good';
        this.isExerciseActive = false;
        this.startExerciseBtn.innerHTML = '<span>🔄</span> Restart Exercise';
        this._stopAllTimers();
        this.markExerciseComplete(exercise.id);
      }
    }

    // Update progress
    const totalReps = exercise.targetSets * exercise.targetReps;
    const completedReps = (this.currentSet - 1) * exercise.targetReps + this.currentReps;
    this.updateProgress(completedReps / totalReps);
  }

  // ============================================================
  // Form Feedback
  // ============================================================

  _updateFeedback(angle, tracking) {
    // Don't overwrite hold or rep-complete messages briefly
    if (this._trackState === TrackState.HOLDING) return;

    const inActive = this._isInRange(angle, tracking.activeAngle, tracking.entryThreshold);
    const inRest = this._isInRange(angle, tracking.restAngle, tracking.entryThreshold);

    switch (this._trackState) {
      case TrackState.IDLE:
        this.formFeedback.textContent = '🎯 Get into starting position';
        this.formFeedback.className = 'form-feedback';
        this.angleValue.className = 'angle-value';
        break;

      case TrackState.REST:
        this.formFeedback.textContent = '✅ Good starting position — begin the movement';
        this.formFeedback.className = 'form-feedback good';
        this.angleValue.className = 'angle-value';
        break;

      case TrackState.MOVING:
        // Guide toward active range
        if (angle < tracking.activeAngle.min) {
          this.formFeedback.textContent = '↕️ Keep going — bend more';
          this.formFeedback.className = 'form-feedback adjust';
        } else if (angle > tracking.activeAngle.max) {
          this.formFeedback.textContent = '↕️ Keep going — straighten more';
          this.formFeedback.className = 'form-feedback adjust';
        }
        this.angleValue.className = 'angle-value warning';
        break;

      case TrackState.ACTIVE:
        this.formFeedback.textContent = '✅ Perfect position!';
        this.formFeedback.className = 'form-feedback good';
        this.angleValue.className = 'angle-value';
        break;

      case TrackState.RETURNING:
        this.formFeedback.textContent = '↩️ Return to starting position';
        this.formFeedback.className = 'form-feedback';
        this.angleValue.className = 'angle-value';
        break;
    }
  }

  updateProgress(fraction) {
    const pct = Math.min(100, Math.round(fraction * 100));
    this.progressFill.style.width = `${pct}%`;
    this.progressValue.textContent = `${pct}%`;
    if (this.currentExercise) {
      this.progressLabel.textContent = `Set ${this.currentSet} of ${this.currentExercise.targetSets}`;
    }
  }

  showCameraPlaceholder(show) {
    this.cameraPlaceholder.style.display = show ? 'flex' : 'none';
  }

  hideLoading() {
    const loading = document.getElementById('loading-screen');
    if (loading) {
      loading.classList.add('hidden');
      setTimeout(() => loading.remove(), 500);
    }
  }

  setLoadingText(text) {
    const el = document.getElementById('loading-text');
    if (el) el.textContent = text;
  }
}

