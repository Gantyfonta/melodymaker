import './index.css';

// Config / state
const rows = 61;             // 61 keys (C2 - C7)
let steps = 32;             // steps in the sequence
let bpm = 120;
let isPlaying = false;
let currentStep = 0;
let audioCtx = null;
let schedulerTimer = null;
let masterGain = null;
const stepDurationFactor = 1/4; // sixteenth notes

let tracks = [];
let nextTrackId = 1;
let activeTrackIndex = 0;
let pitches = [];

// DOM Element bindings
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
const deleteTrackBtn = document.getElementById('deleteTrackBtn');
const clearBtn = document.getElementById('clearBtn');
const randomBtn = document.getElementById('randomBtn');
const saveBtn = document.getElementById('saveBtn');
const loadBtn = document.getElementById('loadBtn');
const infoEl = document.getElementById('info');
const trackTabsEl = document.getElementById('trackTabs');

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

function getCurrentGrid() {
    return tracks[activeTrackIndex].grid;
}

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
  const root = 36; // C2
  const scale = SCALES[scaleName] || SCALES.chromatic;
  const map = [];
  let octave = 0;
  
  while(map.length < numRows){
    for(let s = 0; s < scale.length && map.length < numRows; s++){
      map.push(root + scale[s] + octave*12);
    }
    octave++;
  }
  return map.reverse(); 
}

function getNoteColor(midi) {
    const colors = [
        '#e21c48', '#e9403a', '#f26622', '#f6821f', 
        '#f99d1c', '#8dc63f', '#47b068', '#00aeef', 
        '#0084c9', '#0054a6', '#3b368c', '#662d91'
    ];
    return colors[Math.round(midi) % 12];
}

function noteNameFromMidi(midi, includeOctave = false){
  if(!Number.isFinite(midi)) return '';
  const names = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  const mi = Math.round(midi);
  const note = names[mi % 12];
  const octave = Math.floor(mi/12) - 1;
  return includeOctave ? `${note}${octave}` : note;
}

function initGrid(r, c){
  if (tracks.length === 0) {
      tracks = [{ id: nextTrackId++, waveType: 'piano', grid: [] }];
  }
  tracks.forEach(track => {
      const newGrid = Array.from({length: r}, ()=> Array(c).fill(0));
      if (track.grid && track.grid.length) {
          for(let i=0; i<Math.min(r, track.grid.length); i++) {
              for(let j=0; j<Math.min(c, track.grid[i].length); j++) {
                  // value is 0 (off), 1 (attack), 2 (stretch)
                  let val = track.grid[i][j];
                  if (typeof val === 'boolean') val = val ? 1 : 0;
                  newGrid[i][j] = val; 
              }
          }
      }
      track.grid = newGrid;
  });
}

function renderTabs() {
    trackTabsEl.innerHTML = '';
    tracks.forEach((track, i) => {
        const tab = document.createElement('div');
        tab.className = `track-tab ${i === activeTrackIndex ? 'active' : ''}`;
        
        const titleSpan = document.createElement('span');
        titleSpan.textContent = `Track ${track.id}`;
        tab.appendChild(titleSpan);

        if (tracks.length > 1) {
            const delBtn = document.createElement('span');
            delBtn.innerHTML = '&times;';
            delBtn.style.color = '#ef4444';
            delBtn.style.marginLeft = '8px';
            delBtn.style.fontSize = '16px';
            delBtn.style.lineHeight = '1';
            delBtn.onclick = (e) => {
                e.stopPropagation();
                if (confirm('Delete this track?')) {
                    tracks.splice(i, 1);
                    if (activeTrackIndex >= tracks.length) activeTrackIndex = Math.max(0, tracks.length - 1);
                    waveSelect.value = tracks[activeTrackIndex].waveType;
                    renderTabs();
                    renderGrid();
                }
            };
            tab.appendChild(delBtn);
        }

        tab.onclick = (e) => {
            if (e.target.tagName.toLowerCase() === 'span' && e.target.style.color === 'rgb(239, 68, 68)') return;
            activeTrackIndex = i;
            waveSelect.value = tracks[i].waveType;
            renderGrid();
            renderTabs();
        };
        trackTabsEl.appendChild(tab);
    });
    
    // Add track button (limit to 6 for sanity)
    if (tracks.length < 6) {
        const addTab = document.createElement('div');
        addTab.className = 'track-tab';
        addTab.textContent = '+ Add Track';
        addTab.onclick = () => {
            const newTrack = {
                id: nextTrackId++,
                waveType: 'synth',
                grid: Array.from({length: rows}, ()=> Array(steps).fill(0))
            };
            tracks.push(newTrack);
            activeTrackIndex = tracks.length - 1;
            waveSelect.value = newTrack.waveType;
            renderGrid();
            renderTabs();
        };
        trackTabsEl.appendChild(addTab);
    }
}

function updateCellVisual(r, c) {
    const val = getCurrentGrid()[r][c];
    const pitch = pitches[r];
    const color = getNoteColor(pitch);
    const cell = gridEl.children[r * steps + c];
    if(!cell) return;
    
    cell.className = 'cell';
    if (Math.floor(c / 2) % 2 === 1) cell.classList.add('beat-alt');
    
    if (val === 1) {
       cell.classList.add('on');
       cell.style.backgroundColor = color;
    } else if (val === 2) {
       cell.classList.add('on', 'stretch');
       cell.style.backgroundColor = color;
    } else {
       cell.style.backgroundColor = '';
    }
}

function renderGrid(){
  gridEl.innerHTML = '';
  gridEl.style.gridTemplateColumns = `repeat(${steps}, minmax(32px, 1fr))`;
  gridEl.style.gridAutoRows = '24px';
  rowLabelsEl.innerHTML = '';

  pitches = buildPitchMap(rows, scaleSelect.value);
  
  // create row labels styled as piano keys
  for(let r=0;r<rows;r++){
    const pitch = pitches[r];
    const isBlack = [1,3,6,8,10].includes(pitch % 12);
    
    const label = document.createElement('div');
    label.className = 'row-label ' + (isBlack ? 'black-key' : 'white-key');
    label.textContent = noteNameFromMidi(pitch, false);
    
    if (!isBlack) label.style.color = getNoteColor(pitch);
    else label.style.color = '#fff';
    
    rowLabelsEl.appendChild(label);
  }

  // create cells container
  for(let r=0;r<rows;r++) {
    for(let c=0;c<steps;c++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.r = r;
      cell.dataset.c = c;
      cell.title = `Pitch: ${noteNameFromMidi(pitches[r], true)} | Step ${c+1}`;
      gridEl.appendChild(cell);
    }
  }

  // Update visuals for all cells at once
  for(let r=0;r<rows;r++) {
      for(let c=0;c<steps;c++) {
          updateCellVisual(r, c);
      }
  }
  
  highlightPlayhead(currentStep);
}

// Drag logic globally on the grid
let isDragging = false;
let dragMode = 0; // 0=none, 1=paint, 2=erase
let dragRow = -1;
let dragCol = -1;

function getCellRC(e) {
    const cell = e.target.closest('.cell');
    if (!cell) return null;
    return { r: +cell.dataset.r, c: +cell.dataset.c };
}

function clearCellAndFixRope(r, c) {
    const grid = getCurrentGrid();
    grid[r][c] = 0;
    // If the next note was a stretch, we cut the rope, making it an attack.
    if (c + 1 < steps && grid[r][c+1] === 2) {
        grid[r][c+1] = 1;
        updateCellVisual(r, c+1);
    }
}

gridEl.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return; // Only process left click
    const rc = getCellRC(e);
    if(!rc) return;
    
    isDragging = true;
    dragRow = rc.r;
    dragCol = rc.c;
    const grid = getCurrentGrid();
    
    if (grid[rc.r][rc.c] === 0 || grid[rc.r][rc.c] === 2) {
        dragMode = 1; // paint
        grid[rc.r][rc.c] = 1;
        ensureAudioStarted();
        if(!isPlaying) playNoteForPitch(pitches[rc.r], 0.25, tracks[activeTrackIndex].waveType);
    } else {
        dragMode = 2; // erase
        clearCellAndFixRope(rc.r, rc.c);
    }
    updateCellVisual(rc.r, rc.c);
});

gridEl.addEventListener('mouseover', (e) => {
    if (!isDragging) return;
    const rc = getCellRC(e);
    if (!rc) return;
    
    const grid = getCurrentGrid();
    if (dragMode === 1 && rc.r === dragRow) {
        if (rc.c > dragCol) {
            // Dragged to the right, create stretch connection
            for(let i = dragCol+1; i <= rc.c; i++) {
                grid[rc.r][i] = 2; // Stretch type
                updateCellVisual(rc.r, i);
            }
            dragCol = rc.c;
        } else if (rc.c < dragCol) {
            dragCol = rc.c; // Update anchor but don't delete automatically (it's simpler)
        }
    } else if (dragMode === 1 && rc.r !== dragRow) {
        // Dragged to a new row, start a new attack point
        if (grid[rc.r][rc.c] === 0) {
            grid[rc.r][rc.c] = 1;
            dragRow = rc.r;
            dragCol = rc.c;
            if(!isPlaying) playNoteForPitch(pitches[rc.r], 0.25, tracks[activeTrackIndex].waveType);
        }
    } else if (dragMode === 2) {
        clearCellAndFixRope(rc.r, rc.c);
    }
    updateCellVisual(rc.r, rc.c);
});

document.addEventListener('mouseup', () => {
    isDragging = false;
    dragMode = 0;
});
// Avoid dropping elements if cursor leaves grid boundary while active
document.addEventListener('mouseleave', () => {
    isDragging = false; 
    dragMode = 0; 
});


function playNoteForPitch(midi, duration = 0.25, wave = 'piano'){
  if(!audioCtx) return;
  if(!Number.isFinite(midi)) return;
  
  const freq = midiToFreq(midi);
  const now = audioCtx.currentTime;

  if (wave === 'piano') {
      const osc1 = audioCtx.createOscillator();
      const osc2 = audioCtx.createOscillator();
      const gain1 = audioCtx.createGain();
      const gain2 = audioCtx.createGain();

      osc1.type = 'triangle';
      osc2.type = 'sine';

      osc1.frequency.setValueAtTime(freq, now);
      osc2.frequency.setValueAtTime(freq + (Math.random()*2-1), now); 

      const attack = 0.015;
      const totalLen = Math.max(duration, attack + 0.1);

      gain1.gain.setValueAtTime(0, now);
      gain1.gain.linearRampToValueAtTime(1.0, now + attack);
      gain1.gain.setValueAtTime(1.0, now + totalLen - 0.1);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + totalLen);

      gain2.gain.setValueAtTime(0, now);
      gain2.gain.linearRampToValueAtTime(0.5, now + attack);
      gain2.gain.setValueAtTime(0.5, now + totalLen - 0.1);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + totalLen);

      osc1.connect(gain1);
      osc2.connect(gain2);
      gain1.connect(masterGain);
      gain2.connect(masterGain);

      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + totalLen + 0.1);
      osc2.stop(now + totalLen + 0.1);
      
  } else {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      
      osc.type = wave === 'synth' ? 'square' : wave === 'marimba' ? 'sine' : wave; 
      
      osc.frequency.setValueAtTime(freq, now);

      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(1.0, now + 0.01);
      
      // We allow stretching for marimba too if users draw it, otherwise it's short.
      const totalLen = Math.max(duration, 0.1);
      
      gain.gain.setValueAtTime(1.0, now + totalLen - 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, now + totalLen);
      
      osc.connect(gain);
      gain.connect(masterGain);
      osc.start(now);
      osc.stop(now + totalLen + 0.1);
  }
}

function stepOnce(){
  highlightPlayhead(currentStep);
  currentStep = (currentStep + 1) % steps;
  highlightPlayhead(currentStep);

  const stepTime = (60 / bpm) * stepDurationFactor;

  // play all active tracks simultaneously
  tracks.forEach(track => {
      const g = track.grid;
      for (let r=0; r<rows; r++) {
         if (g[r][currentStep] === 1) { // 1 indicates starting attack block
             let length = 1;
             // Count consecutive stretches
             while (currentStep + length < steps && g[r][currentStep + length] === 2) {
                 length++;
             }
             const duration = length * stepTime;
             playNoteForPitch(pitches[r], duration, track.waveType);
         }
      }
  });
}

function highlightPlayhead(col){
  if(typeof col !== 'number' || col < 0) return;
  // clean up old playheads
  const old = gridEl.querySelectorAll('.playhead');
  old.forEach(el => el.classList.remove('playhead'));
  
  for(let r=0;r<rows;r++){
    const idx = r*steps + col;
    const cell = gridEl.children[idx];
    if(cell) {
        cell.classList.add('playhead');
        if (cell.classList.contains('on')) {
            cell.style.transform = 'scale(1.15)';
            cell.style.zIndex = '15';
            setTimeout(() => {
                cell.style.transform = '';
                cell.style.zIndex = '';
            }, Math.max((60/bpm)*1000/4 - 10, 50));
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
  const old = gridEl.querySelectorAll('.playhead');
  old.forEach(el => el.classList.remove('playhead'));
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
  if (tracks[activeTrackIndex]) {
      tracks[activeTrackIndex].waveType = e.target.value;
  }
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

deleteTrackBtn.addEventListener('click', () => {
    if (tracks.length > 1) {
        if (confirm('Delete this track?')) {
            tracks.splice(activeTrackIndex, 1);
            if (activeTrackIndex >= tracks.length) activeTrackIndex = Math.max(0, tracks.length - 1);
            waveSelect.value = tracks[activeTrackIndex].waveType;
            renderTabs();
            renderGrid();
        }
    } else {
        alert('You must have at least one track.');
    }
});

clearBtn.addEventListener('click',()=>{
  tracks[activeTrackIndex].grid = Array.from({length: rows}, ()=> Array(steps).fill(0));
  renderGrid();
});

randomBtn.addEventListener('click',()=>{
  const g = getCurrentGrid();
  for(let r=0;r<rows;r++) {
      for(let c=0;c<steps;c++) {
          g[r][c] = (Math.random() < 0.06) ? 1 : 0;
      }
  }
  renderGrid();
});

saveBtn.addEventListener('click', ()=>{
  const payload = {
    steps, bpm, scale: scaleSelect.value, tracks
  };
  localStorage.setItem('melody_maker_v4', JSON.stringify(payload));
  playFeedback('Saved locally!');
});

loadBtn.addEventListener('click', ()=>{
  loadFromData(localStorage.getItem('melody_maker_v4'));
});

function loadFromData(raw) {
  if(!raw){ playFeedback('No save found/Invalid code.'); return; }
  try{
    const payload = JSON.parse(raw);
    if(payload.steps) steps = payload.steps;
    if(payload.bpm) { bpm = payload.bpm; tempoInput.value = bpm; bpmLabel.textContent = bpm; }
    if(payload.scale) scaleSelect.value = payload.scale;
    
    // Migration for v3 singular boolean grid payload -> v4 multiple integer tracks
    if(payload.grid && !payload.tracks) {
        const oldGrid = payload.grid;
        const newGrid = Array.from({length: rows}, ()=> Array(steps).fill(0));
        for(let i=0; i<Math.min(rows, oldGrid.length); i++){
            for(let j=0; j<Math.min(steps, oldGrid[i].length); j++){
                newGrid[i][j] = oldGrid[i][j] ? 1 : 0;
            }
        }
        tracks = [{ id: 1, waveType: payload.waveType || 'piano', grid: newGrid }];
    } else if (payload.tracks) {
        tracks = payload.tracks;
        // Fix grid lengths if necessary 
        tracks.forEach(track => {
            if(track.grid.length !== rows) {
                const updated = Array.from({length: rows}, ()=> Array(steps).fill(0));
                for(let i=0; i<Math.min(rows, track.grid.length); i++){
                   if(track.grid[i]) {
                       for(let j=0; j<Math.min(steps, track.grid[i].length); j++){
                           updated[i][j] = track.grid[i][j] || 0;
                       }
                   }
                }
                track.grid = updated;
            }
        });
    }

    tempoSelect.value = steps;
    nextTrackId = (tracks.length > 0 ? Math.max(...tracks.map(t=>t.id)) : 0) + 1;
    activeTrackIndex = 0;
    waveSelect.value = tracks[activeTrackIndex].waveType || 'piano';
    
    renderTabs();
    renderGrid();
    playFeedback('Loaded!');
    return true;
  } catch(err) {
    playFeedback('Load failed.');
    console.error(err);
    return false;
  }
}

// Import Export Modals
exportBtn.addEventListener('click', () => {
  stopPlaying();
  const payload = {
    steps, bpm, scale: scaleSelect.value, tracks
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
        const decoded = atob(raw);
        if (loadFromData(decoded)) {
            modalOverlay.style.display = 'none';
        } else {
            alert('Could not decode the data completely.');
        }
    } catch(e) {
        alert('Invalid code formatting.');
    }
  }
});

function playFeedback(msg){
  infoEl.textContent = msg;
  setTimeout(()=> infoEl.textContent = '', 2000);
}

document.addEventListener('DOMContentLoaded', () => {
    tempoSelect.value = steps;
    waveSelect.value = 'piano';
    scaleSelect.value = 'chromatic';
    if(tracks.length === 0){
      initGrid(rows, steps);
    }
    currentStep = -1;
    renderTabs();
    renderGrid();
});

window.addEventListener('keydown', (e)=>{
  if(e.code === 'Space' && e.target === document.body) { 
      e.preventDefault(); 
      playBtn.click(); 
  }
});
