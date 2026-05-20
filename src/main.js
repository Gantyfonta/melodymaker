// Config / state
const rows = 15;             // 2 octaves + root note
let steps = 32;             // steps in the sequence
let bpm = 120;
let isPlaying = false;
let currentStep = 0;
let audioCtx = null;
let schedulerTimer = null;
let waveType = 'piano';
let masterGain = null;
let gridState = []; // rows x steps booleans
const stepDurationFactor = 1/4; // sixteenth notes

// DOM
const gridEl = document.getElementById('grid');
const rowLabelsEl = document.getElementById('rowLabels');
const playBtn = document.getElementById('playBtn');
const stopBtn = document.getElementById('stopBtn');
const tempoInput = document.getElementById('tempo');
const bpmLabel = document.getElementById('bpmLabel');
const tempoSelect = document.getElementById('stepsSelect');
const waveSelect = document.getElementById('waveSelect');
const volInput = document.getElementById('volume');
const scaleSelect = document.getElementById('scaleSelect');
const clearBtn = document.getElementById('clearBtn');
const randomBtn = document.getElementById('randomBtn');
const saveBtn = document.getElementById('saveBtn');
const loadBtn = document.getElementById('loadBtn');
const infoEl = document.getElementById('info');

// Import / Export DOM
const exportBtn = document.getElementById('exportBtn');
const importBtn = document.getElementById('importBtn');
const legendBtn = document.getElementById('legendBtn');
const modalOverlay = document.getElementById('modalOverlay');
const legendOverlay = document.getElementById('legendOverlay');
const legendCloseBtn = document.getElementById('legendCloseBtn');
const modalTitle = document.getElementById('modalTitle');
const modalDesc = document.getElementById('modalDesc');
const modalTextarea = document.getElementById('modalTextarea');
const modalActionBtn = document.getElementById('modalActionBtn');
const modalCloseBtn = document.getElementById('modalCloseBtn');
let modalMode = 'none';

// Utility: midi -> freq
function midiToFreq(m){ return 440 * Math.pow(2, (m - 69)/12); }

// Build scales given a root MIDI
const SCALES = {
  chromatic: [0,1,2,3,4,5,6,7,8,9,10,11],
  major: [0,2,4,5,7,9,11],
  minor: [0,2,3,5,7,8,10],
  pentatonic: [0,2,4,7,9]
};

function buildPitchMap(numRows, scaleName){
  const root = 48; // C3 (so 2 octaves up is C5)
  const scale = SCALES[scaleName] || SCALES.major;
  const pitches = [];
  let octave = 0;
  
  // build from bottom up
  while(pitches.length < numRows){
    for(let s = 0; s < scale.length && pitches.length < numRows; s++){
      pitches.push(root + scale[s] + octave*12);
    }
    octave++;
  }
  // Reverse to make index 0 the highest pitch (top of grid)
  return pitches.reverse(); 
}

function getNoteColor(midi) {
    // Chrome Music Lab style rainbow colors
    const colors = [
        '#e21c48', // 0 C
        '#e9403a', // 1 C#
        '#f26622', // 2 D
        '#f6821f', // 3 D#
        '#f99d1c', // 4 E
        '#8dc63f', // 5 F
        '#47b068', // 6 F#
        '#00aeef', // 7 G
        '#0084c9', // 8 G#
        '#0054a6', // 9 A
        '#3b368c', // 10 A#
        '#662d91'  // 11 B
    ];
    return colors[Math.round(midi) % 12];
}

// initialize grid state
function initGrid(r, c){
  gridState = Array.from({length: r}, ()=> Array(c).fill(false));
}

// render grid
function renderGrid(){
  gridEl.innerHTML = '';
  // dynamically set columns css
  gridEl.style.gridTemplateColumns = `repeat(${steps}, minmax(32px, 1fr))`;
  gridEl.style.gridAutoRows = '32px';
  rowLabelsEl.innerHTML = '';

  const pitches = buildPitchMap(rows, scaleSelect.value);
  
  // create row labels
  for(let r=0;r<rows;r++){
    const label = document.createElement('div');
    label.className = 'row-label';
    label.textContent = noteNameFromMidi(pitches[r]);
    const color = getNoteColor(pitches[r]);
    label.style.color = color;
    rowLabelsEl.appendChild(label);
  }

  // create cells
  for(let r=0;r<rows;r++){
    const pitch = pitches[r];
    const color = getNoteColor(pitch);
    for(let c=0;c<steps;c++){
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.r = r;
      cell.dataset.c = c;
      
      // alternate background for beat separation (groups of 2 subdivs per beat)
      if (Math.floor(c / 2) % 2 === 1) {
          cell.classList.add('beat-alt');
      }
      
      if(gridState[r]?.[c]) {
          cell.classList.add('on');
          cell.style.backgroundColor = color;
      }
      cell.title = `${noteNameFromMidi(pitch)} (Step ${c+1})`;
      
      // Click logic
      cell.addEventListener('mousedown', (e)=>{
        const rr = +cell.dataset.r, cc = +cell.dataset.c;
        gridState[rr][cc] = !gridState[rr][cc];
        
        if (gridState[rr][cc]) {
            cell.classList.add('on');
            cell.style.backgroundColor = color;
            ensureAudioStarted();
            playNoteForPitch(pitch);
        } else {
            cell.classList.remove('on');
            cell.style.backgroundColor = '';
        }
      });
      
      // Dragging logic
      cell.addEventListener('mouseenter', (e) => {
          if (e.buttons === 1) { // 1 means primary mouse button is held down
              const rr = +cell.dataset.r, cc = +cell.dataset.c;
              // To avoid toggling repeatedly on enter, we just 'paint' it on
              if (!gridState[rr][cc]) {
                  gridState[rr][cc] = true;
                  cell.classList.add('on');
                  cell.style.backgroundColor = color;
                  ensureAudioStarted();
                  if (!isPlaying) playNoteForPitch(pitch);
              }
          }
      });
      
      gridEl.appendChild(cell);
    }
  }
  highlightPlayhead(currentStep);
}

function noteNameFromMidi(midi){
  if(!Number.isFinite(midi)) return '';
  const names = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  const mi = Math.round(midi);
  const note = names[mi % 12];
  const octave = Math.floor(mi/12) - 1;
  return `${note}${octave}`;
}

// play a single pitch with synth engines
function playNoteForPitch(midi){
  if(!audioCtx) return;
  if(!Number.isFinite(midi)) return;
  const freq = midiToFreq(midi);

  if (waveType === 'piano') {
      const osc1 = audioCtx.createOscillator();
      const osc2 = audioCtx.createOscillator();
      const gain1 = audioCtx.createGain();
      const gain2 = audioCtx.createGain();

      osc1.type = 'triangle';
      osc2.type = 'sine';

      osc1.frequency.setValueAtTime(freq, audioCtx.currentTime);
      osc2.frequency.setValueAtTime(freq + (Math.random()*2-1), audioCtx.currentTime); 

      const now = audioCtx.currentTime;
      const attack = 0.015;
      const decay = 1.0;

      gain1.gain.setValueAtTime(0, now);
      gain1.gain.linearRampToValueAtTime(1.0, now + attack);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + attack + decay);

      gain2.gain.setValueAtTime(0, now);
      gain2.gain.linearRampToValueAtTime(0.5, now + attack);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + attack + decay * 0.7);

      osc1.connect(gain1);
      osc2.connect(gain2);
      gain1.connect(masterGain);
      gain2.connect(masterGain);

      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + attack + decay);
      osc2.stop(now + attack + decay);
  } else {
      // standard synth fallback
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      
      osc.type = waveType === 'synth' ? 'square' : waveType === 'marimba' ? 'sine' : waveType; 
      
      osc.frequency.setValueAtTime(freq, audioCtx.currentTime);

      gain.gain.setValueAtTime(0, audioCtx.currentTime);
      const now = audioCtx.currentTime;
      gain.gain.linearRampToValueAtTime(1.0, now + 0.01);
      
      osc.connect(gain);
      gain.connect(masterGain);
      osc.start(now);
      
      if (waveType === 'marimba') {
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
          osc.stop(now + 0.35);
      } else {
          gain.gain.exponentialRampToValueAtTime(0.01, now + 0.25);
          osc.stop(now + 0.3);
      }
  }
}

function playNoteForRow(r){
    const pitches = buildPitchMap(rows, scaleSelect.value);
    playNoteForPitch(pitches[r]);
}

function stepOnce(){
  highlightPlayhead(currentStep);
  currentStep = (currentStep + 1) % steps;
  highlightPlayhead(currentStep);

  for(let r=0;r<rows;r++){
    if(gridState[r][currentStep]) playNoteForRow(r);
  }
}

function highlightPlayhead(col){
  const cells = gridEl.querySelectorAll('.cell');
  cells.forEach(cell => cell.classList.remove('playhead'));
  if(typeof col !== 'number' || col < 0) return;
  
  for(let r=0;r<rows;r++){
    const idx = r*steps + col;
    const cell = gridEl.children[idx];
    if(cell) {
        cell.classList.add('playhead');
        if (cell.classList.contains('on')) {
            // Little bounce when hit via playhead
            cell.style.transform = 'scale(1.15)';
            setTimeout(() => cell.style.transform = '', Math.max((60/bpm)*1000/4 - 10, 50));
        }
    }
  }
}

function startPlaying(){
  if(isPlaying) return;
  ensureAudioStarted();
  isPlaying = true;
  playBtn.textContent = 'Pause';
  function schedule(){
    stepOnce();
    const stepTime = (60 / bpm) * stepDurationFactor * 1000;
    schedulerTimer = setTimeout(schedule, stepTime);
  }
  schedulerTimer = setTimeout(() => schedule(), 0);
}

function stopPlaying(){
  isPlaying = false;
  playBtn.textContent = 'Play';
  clearTimeout(schedulerTimer);
  schedulerTimer = null;
  currentStep = -1;
  highlightPlayhead(-1);
}

function ensureAudioStarted(){
  if(!audioCtx){
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = parseFloat(volInput.value) || 0.25;
    masterGain.connect(audioCtx.destination);
  }
  if(audioCtx.state === 'suspended') audioCtx.resume();
}

// Events
tempoInput.addEventListener('input', (e)=>{
  bpm = +e.target.value;
  bpmLabel.textContent = bpm;
});

tempoSelect.addEventListener('change', (e)=>{
  steps = +e.target.value;
  initGrid(rows, steps);
  renderGrid();
});

waveSelect.addEventListener('change', (e)=>{
  waveType = e.target.value;
  ensureAudioStarted();
});

volInput.addEventListener('input', (e)=>{
  if(masterGain) masterGain.gain.value = parseFloat(e.target.value);
});

scaleSelect.addEventListener('change', ()=>{
  renderGrid();
});

playBtn.addEventListener('click', ()=>{
  if(!audioCtx) ensureAudioStarted();
  if(isPlaying){
    clearTimeout(schedulerTimer);
    isPlaying = false;
    playBtn.textContent = 'Play';
  } else {
    if(currentStep < 0) currentStep = -1;
    startPlaying();
  }
});

stopBtn.addEventListener('click', stopPlaying);

clearBtn.addEventListener('click',()=>{
  initGrid(rows, steps);
  renderGrid();
});

randomBtn.addEventListener('click',()=>{
  for(let r=0;r<rows;r++){
    for(let c=0;c<steps;c++){
      gridState[r][c] = Math.random() < 0.06;
    }
  }
  renderGrid();
});

saveBtn.addEventListener('click', ()=>{
  const payload = {
    steps, bpm, waveType, scale: scaleSelect.value, grid: gridState
  };
  localStorage.setItem('melody_maker_v3', JSON.stringify(payload));
  playFeedback('Saved locally!');
});

loadBtn.addEventListener('click', ()=>{
  const raw = localStorage.getItem('melody_maker_v3');
  if(!raw){ playFeedback('No save found.'); return; }
  try{
    const payload = JSON.parse(raw);
    if(payload.steps) steps = payload.steps;
    if(payload.bpm) { bpm = payload.bpm; tempoInput.value = bpm; bpmLabel.textContent = bpm; }
    if(payload.waveType) waveType = payload.waveType, waveSelect.value = waveType;
    if(payload.scale) scaleSelect.value = payload.scale;
    if(payload.grid) gridState = payload.grid;
    
    if(!gridState || gridState.length !== rows) {
      initGrid(rows, steps);
    } else {
      for(let r=0;r<rows;r++){
        if(!gridState[r]) gridState[r] = Array(steps).fill(false);
        else gridState[r].length = steps;
      }
    }
    tempoSelect.value = steps;
    scaleSelect.value = payload.scale || 'major';
    renderGrid();
    playFeedback('Loaded!');
  }catch(err){
    playFeedback('Load failed.');
  }
});

// Import Export Modals
exportBtn.addEventListener('click', () => {
  stopPlaying();
  const payload = {
    steps, bpm, waveType, scale: scaleSelect.value, grid: gridState
  };
  const b64 = btoa(JSON.stringify(payload));
  modalMode = 'export';
  modalTitle.textContent = 'Share Song';
  modalDesc.textContent = 'Copy this code to share with others:';
  modalTextarea.value = b64;
  modalTextarea.readOnly = true;
  modalActionBtn.textContent = 'Copy Code';
  modalOverlay.style.display = 'flex';
});

importBtn.addEventListener('click', () => {
  stopPlaying();
  modalMode = 'import';
  modalTitle.textContent = 'Load Song';
  modalDesc.textContent = 'Paste a song code here to load it:';
  modalTextarea.value = '';
  modalTextarea.readOnly = false;
  modalActionBtn.textContent = 'Load Song';
  modalOverlay.style.display = 'flex';
});

legendBtn.addEventListener('click', () => {
  stopPlaying();
  legendOverlay.style.display = 'flex';
});

legendCloseBtn.addEventListener('click', () => {
  legendOverlay.style.display = 'none';
});

modalCloseBtn.addEventListener('click', () => {
  modalOverlay.style.display = 'none';
  modalMode = 'none';
});

modalActionBtn.addEventListener('click', () => {
  if (modalMode === 'export') {
    navigator.clipboard.writeText(modalTextarea.value).then(() => {
      modalActionBtn.textContent = 'Copied!';
      setTimeout(() => { if (modalMode === 'export') modalActionBtn.textContent = 'Copy Code'; }, 2000);
    });
  } else if (modalMode === 'import') {
    const raw = modalTextarea.value.trim();
    if (!raw) return;
    try {
      const payload = JSON.parse(atob(raw));
      if(payload.steps) steps = payload.steps;
      if(payload.bpm) { bpm = payload.bpm; tempoInput.value = bpm; bpmLabel.textContent = bpm; }
      if(payload.waveType) waveType = payload.waveType, waveSelect.value = waveType;
      if(payload.scale) scaleSelect.value = payload.scale;
      if(payload.grid) gridState = payload.grid;
      
      if(!gridState || gridState.length !== rows) {
        initGrid(rows, steps);
      } else {
        for(let r=0;r<rows;r++){
          if(!gridState[r]) gridState[r] = Array(steps).fill(false);
          else gridState[r].length = steps;
        }
      }
      tempoSelect.value = steps;
      scaleSelect.value = payload.scale || 'major';
      renderGrid();
      modalOverlay.style.display = 'none';
      playFeedback('Song imported successfully!');
    } catch(err) {
      alert('Invalid song code. Make sure you pasted the exact exported code.');
    }
  }
});

function playFeedback(msg){
  infoEl.textContent = msg;
  setTimeout(()=> infoEl.textContent = '', 2000);
}

document.addEventListener('DOMContentLoaded', () => {
    tempoSelect.value = steps;
    waveSelect.value = waveType;
    if(!gridState || gridState.length !== rows || gridState[0].length !== steps){
      initGrid(rows, steps);
    }
    currentStep = -1;
    renderGrid();
});

window.addEventListener('keydown', (e)=>{
  if(e.code === 'Space' && e.target === document.body) { 
      e.preventDefault(); 
      playBtn.click(); 
  }
});
