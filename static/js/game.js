// Catch the Object Challenge Game
// Humanoid dual-arm robot catches objects from a conveyor belt

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// === Game State ===
let gameRunning = false;
let gameOver = false;
let score = 0;
let highScore = localStorage.getItem('catchGameHighScore') || 0;
let conveyorSpeed = 1.5;
let spawnTimer = 0;
let spawnInterval = 120;
let frameCount = 0;
let catchRadius = 32; // shrinks over time
const MIN_CATCH_RADIUS = 12;

// === Robot Body ===
const robot = {
  x: 400,          // center x (moves with controlled arm)
  headY: 28,
  torsoTop: 52,
  torsoBottom: 100,
  torsoWidth: 48,
  headRadius: 16,
  shoulderSpan: 32, // closer to body (was 60)
  moveSpeed: 4.5,
};

// === Arms ===
function makeArm(side) {
  return {
    side,             // 'left' or 'right'
    upperLen: 65,
    lowerLen: 70,
    reaching: false,
    reachProgress: 0,
    reachSpeed: 0.065,
    retracting: false,
    holdingObject: null,
    gripClosed: false,
    restY: 115,
    catchY: 345,
  };
}
const leftArm = makeArm('left');
const rightArm = makeArm('right');

// Left arm is player-controlled, right arm is AI/idle
const controlledArm = leftArm;
const idleArm = rightArm;

// Idle arm wave animation
let idleWavePhase = 0;

// === Conveyor Belt ===
const conveyor = { y: 370, height: 30, beltOffset: 0 };

// === Objects ===
let objects = [];
let popups = [];
let caughtCount = 0;

const objectTypes = [
  { type: 'bottle',  color: '#3b82f6', width: 22, height: 46, points: 1, label: 'Bottle' },
  { type: 'box',     color: '#f59e0b', width: 36, height: 30, points: 1, label: 'Box' },
  { type: 'can',     color: '#ef4444', width: 20, height: 30, points: 2, label: 'Can' },
  { type: 'diamond', color: '#a855f7', width: 24, height: 24, points: 3, label: 'Diamond' },
  { type: 'flask',   color: '#10b981', width: 26, height: 40, points: 2, label: 'Flask' },
  { type: 'bluecan', color: '#1e40af', width: 20, height: 30, points: 10, label: 'Blue Can' },
];

const keys = {};
document.getElementById('gameHighScore').textContent = highScore;

// === Helpers ===
function getShoulderX(arm) {
  return arm.side === 'left'
    ? robot.x - robot.shoulderSpan
    : robot.x + robot.shoulderSpan;
}

// === Inverse Kinematics (2-link) ===
function solveIK(sx, sy, tx, ty, uLen, lLen) {
  const dx = tx - sx, dy = ty - sy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const maxReach = uLen + lLen - 2;
  const c = Math.min(dist, maxReach);
  const angle = Math.atan2(dx, dy);
  let cosE = (uLen * uLen + lLen * lLen - c * c) / (2 * uLen * lLen);
  cosE = Math.max(-1, Math.min(1, cosE));
  const elbowAngle = Math.PI - Math.acos(cosE);
  let cosS = (uLen * uLen + c * c - lLen * lLen) / (2 * uLen * c);
  cosS = Math.max(-1, Math.min(1, cosS));
  const shoulderAngle = angle - Math.acos(cosS);
  return { shoulderAngle, elbowAngle };
}

function getArmPositions(sx, sy, shoulderAngle, elbowAngle, uLen, lLen) {
  const ex = sx + Math.sin(shoulderAngle) * uLen;
  const ey = sy + Math.cos(shoulderAngle) * uLen;
  const total = shoulderAngle + elbowAngle;
  const hx = ex + Math.sin(total) * lLen;
  const hy = ey + Math.cos(total) * lLen;
  return { ex, ey, hx, hy };
}

// === Spawn ===
function spawnObject() {
  const t = objectTypes[Math.floor(Math.random() * objectTypes.length)];
  objects.push({
    x: -t.width, y: conveyor.y - t.height,
    width: t.width, height: t.height,
    color: t.color, type: t.type,
    points: t.points, label: t.label,
    grabbed: false, scored: false,
  });
}

// === Drawing ===
function drawBackground() {
  const g = ctx.createLinearGradient(0, 0, 0, canvas.height);
  g.addColorStop(0, '#1a1a2e');
  g.addColorStop(1, '#16213e');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = 'rgba(255,255,255,0.03)';
  ctx.lineWidth = 1;
  for (let x = 0; x < canvas.width; x += 40) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
  }
  for (let y = 0; y < canvas.height; y += 40) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
  }
}

function drawConveyor() {
  ctx.fillStyle = '#3a3a3a';
  ctx.fillRect(0, conveyor.y, canvas.width, conveyor.height);
  conveyor.beltOffset = (conveyor.beltOffset + conveyorSpeed) % 20;
  ctx.strokeStyle = '#555';
  ctx.lineWidth = 2;
  for (let x = -20 + conveyor.beltOffset; x < canvas.width + 20; x += 20) {
    ctx.beginPath();
    ctx.moveTo(x, conveyor.y);
    ctx.lineTo(x - 8, conveyor.y + conveyor.height);
    ctx.stroke();
  }
  ctx.fillStyle = '#666';
  ctx.fillRect(0, conveyor.y - 3, canvas.width, 3);
  ctx.fillRect(0, conveyor.y + conveyor.height, canvas.width, 3);
  for (const rx of [15, canvas.width - 15]) {
    ctx.fillStyle = '#888';
    ctx.beginPath();
    ctx.arc(rx, conveyor.y + conveyor.height / 2, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#555'; ctx.lineWidth = 2; ctx.stroke();
  }
  ctx.fillStyle = '#0d0d1a';
  ctx.fillRect(0, conveyor.y + conveyor.height + 3, canvas.width, 80);
}

function drawRail() {
  ctx.fillStyle = '#2a2a3a';
  ctx.fillRect(20, 0, canvas.width - 40, 8);
  ctx.fillStyle = '#444';
  ctx.fillRect(20, 8, canvas.width - 40, 2);
  // Mount plate
  ctx.fillStyle = '#3a3a4a';
  ctx.fillRect(robot.x - 28, 0, 56, 14);
  ctx.fillStyle = '#666';
  for (const bx of [-18, 18]) {
    ctx.beginPath();
    ctx.arc(robot.x + bx, 6, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

// === Robot Body (Themis-style: white/black, boxy) ===
function drawRobotBody() {
  const cx = robot.x;
  ctx.save();

  // --- Head (boxy, white with black accents) ---
  // Main head box
  ctx.fillStyle = '#f5f5f5';
  ctx.fillRect(cx - 14, robot.headY - 14, 28, 26);
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(cx - 14, robot.headY - 14, 28, 26);

  // Top visor/antenna panel (black)
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(cx - 12, robot.headY - 16, 24, 4);
  
  // Eyes (black with cyan glow)
  const eyeY = robot.headY - 3;
  ctx.fillStyle = '#000';
  ctx.fillRect(cx - 8, eyeY - 3, 4, 6);
  ctx.fillRect(cx + 4, eyeY - 3, 4, 6);
  ctx.fillStyle = '#00eeff';
  ctx.shadowColor = '#00eeff';
  ctx.shadowBlur = 6;
  ctx.fillRect(cx - 8, eyeY - 3, 4, 6);
  ctx.fillRect(cx + 4, eyeY - 3, 4, 6);
  ctx.shadowBlur = 0;

  // Mouth line
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx - 8, eyeY + 6);
  ctx.lineTo(cx + 8, eyeY + 6);
  ctx.stroke();

  // --- Neck (black connector) ---
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(cx - 5, robot.headY + 12, 10, 6);

  // --- Torso (white box with black panel) ---
  const tw = robot.torsoWidth;
  const tt = robot.torsoTop;
  const tb = robot.torsoBottom;
  
  // Main torso
  ctx.fillStyle = '#f5f5f5';
  ctx.fillRect(cx - tw / 2, tt, tw, tb - tt);
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(cx - tw / 2, tt, tw, tb - tt);

  // Center chest panel (black)
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(cx - 10, tt + 6, 20, 24);
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 1;
  ctx.strokeRect(cx - 10, tt + 6, 20, 24);

  // Chest status light (green when running)
  ctx.fillStyle = gameRunning ? '#10b981' : '#555';
  ctx.shadowColor = gameRunning ? '#10b981' : 'transparent';
  ctx.shadowBlur = gameRunning ? 8 : 0;
  ctx.beginPath();
  ctx.arc(cx, tt + 18, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  // Panel dividers
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(cx - 10, tt + 12);
  ctx.lineTo(cx + 10, tt + 12);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - 10, tt + 18);
  ctx.lineTo(cx + 10, tt + 18);
  ctx.stroke();

  // --- Shoulder/Arm mounts (black ball joints) ---
  for (const side of [-1, 1]) {
    const sx = cx + side * robot.shoulderSpan;
    const sy = robot.torsoTop + 5;
    // Black shoulder joint
    ctx.fillStyle = '#1a1a1a';
    ctx.beginPath();
    ctx.arc(sx, sy, 7.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    ctx.stroke();
    // Inner detail
    ctx.fillStyle = '#333';
    ctx.beginPath();
    ctx.arc(sx, sy, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

// === Draw One Arm (white/black, boxy) ===
function drawOneArm(arm, shoulderAngle, elbowAngle, isControlled) {
  const sx = getShoulderX(arm);
  const sy = robot.torsoTop + 5;
  const pos = getArmPositions(sx, sy, shoulderAngle, elbowAngle, arm.upperLen, arm.lowerLen);

  ctx.save();

  // Color scheme: white exterior, black joints
  const armColor = '#e8e8e8';
  const jointColor = '#1a1a1a';
  const accentColor = isControlled ? '#00eeff' : '#666';

  // Upper arm (white with black outline)
  ctx.strokeStyle = armColor;
  ctx.lineWidth = 14;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(pos.ex, pos.ey);
  ctx.stroke();
  
  // Upper arm outline
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(pos.ex, pos.ey);
  ctx.stroke();

  // Elbow joint (black ball)
  ctx.fillStyle = jointColor;
  ctx.beginPath();
  ctx.arc(pos.ex, pos.ey, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Forearm (white with black outline)
  ctx.strokeStyle = armColor;
  ctx.lineWidth = 12;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(pos.ex, pos.ey);
  ctx.lineTo(pos.hx, pos.hy);
  ctx.stroke();
  
  // Forearm outline
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(pos.ex, pos.ey);
  ctx.lineTo(pos.hx, pos.hy);
  ctx.stroke();

  // Wrist joint (black)
  ctx.fillStyle = jointColor;
  ctx.beginPath();
  ctx.arc(pos.hx, pos.hy, 5.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 1;
  ctx.stroke();

  // Hand/Gripper
  drawHand(pos.hx, pos.hy, shoulderAngle + elbowAngle, arm.gripClosed, arm.holdingObject, isControlled);

  ctx.restore();
}

function drawHand(x, y, angle, closed, holding, isControlled) {
  const open = closed ? 0.03 : 0.25;
  const fingerLen = 20;
  ctx.save();
  
  const offsets = [-open * 1.2, 0, open * 1.2];
  
  offsets.forEach((offset, i) => {
    const fAngle = angle + offset;
    const fx = x + Math.sin(fAngle) * fingerLen;
    const fy = y + Math.cos(fAngle) * fingerLen;
    
    // Finger (white)
    ctx.strokeStyle = '#e8e8e8';
    ctx.lineWidth = closed ? 3.5 : 2.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(fx, fy);
    ctx.stroke();
    
    // Finger outline
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(fx, fy);
    ctx.stroke();

    // Fingertip (glow green when holding)
    ctx.fillStyle = holding ? '#10b981' : '#d0d0d0';
    ctx.shadowColor = holding ? '#10b981' : 'transparent';
    ctx.shadowBlur = holding ? 4 : 0;
    ctx.beginPath();
    ctx.arc(fx, fy, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  });
  
  ctx.restore();
}

function drawObject(obj) {
  ctx.save();
  
  // Blue can becomes invisible when near the robot shoulder
  if (obj.type === 'bluecan') {
    const sx = getShoulderX(controlledArm);
    const dist = Math.abs(sx - (obj.x + obj.width / 2));
    if (dist < 120) {
      ctx.globalAlpha = 0;
    }
  }
  
  ctx.shadowColor = obj.color;
  ctx.shadowBlur = 6;
  switch (obj.type) {
    case 'bottle':
      ctx.fillStyle = obj.color;
      ctx.fillRect(obj.x + 3, obj.y + 10, obj.width - 6, obj.height - 10);
      ctx.fillRect(obj.x + 6, obj.y, obj.width - 12, 14);
      ctx.fillStyle = '#ddd';
      ctx.fillRect(obj.x + 7, obj.y - 3, obj.width - 14, 5);
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.fillRect(obj.x + 5, obj.y + 20, obj.width - 10, 12);
      break;
    case 'box':
      ctx.fillStyle = obj.color;
      ctx.fillRect(obj.x, obj.y, obj.width, obj.height);
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.fillRect(obj.x + obj.width / 2 - 3, obj.y, 6, obj.height);
      ctx.strokeStyle = 'rgba(255,255,255,0.2)';
      ctx.lineWidth = 1;
      ctx.strokeRect(obj.x, obj.y, obj.width, obj.height);
      break;
    case 'can':
      ctx.fillStyle = obj.color;
      ctx.beginPath();
      ctx.ellipse(obj.x + obj.width / 2, obj.y + obj.height / 2, obj.width / 2, obj.height / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ccc';
      ctx.beginPath();
      ctx.ellipse(obj.x + obj.width / 2, obj.y + 4, obj.width / 2 - 2, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'bluecan':
      ctx.fillStyle = obj.color;
      ctx.beginPath();
      ctx.ellipse(obj.x + obj.width / 2, obj.y + obj.height / 2, obj.width / 2, obj.height / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.ellipse(obj.x + obj.width / 2, obj.y + 4, obj.width / 2 - 2, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'diamond':
      ctx.fillStyle = obj.color;
      var dcx = obj.x + obj.width / 2, dcy = obj.y + obj.height / 2;
      ctx.beginPath();
      ctx.moveTo(dcx, obj.y); ctx.lineTo(obj.x + obj.width, dcy);
      ctx.lineTo(dcx, obj.y + obj.height); ctx.lineTo(obj.x, dcy);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.beginPath();
      ctx.moveTo(dcx, obj.y + 4); ctx.lineTo(dcx + 4, dcy);
      ctx.lineTo(dcx, dcy + 2); ctx.lineTo(dcx - 2, dcy);
      ctx.closePath(); ctx.fill();
      break;
    case 'flask':
      ctx.fillStyle = obj.color;
      ctx.fillRect(obj.x + 8, obj.y, obj.width - 16, 15);
      ctx.beginPath();
      ctx.moveTo(obj.x + 5, obj.y + 15);
      ctx.lineTo(obj.x, obj.y + obj.height);
      ctx.lineTo(obj.x + obj.width, obj.y + obj.height);
      ctx.lineTo(obj.x + obj.width - 5, obj.y + 15);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ctx.beginPath();
      ctx.moveTo(obj.x + 3, obj.y + 25);
      ctx.lineTo(obj.x + 1, obj.y + obj.height - 1);
      ctx.lineTo(obj.x + obj.width - 1, obj.y + obj.height - 1);
      ctx.lineTo(obj.x + obj.width - 3, obj.y + 25);
      ctx.closePath(); ctx.fill();
      break;
  }
  ctx.restore();
  if (!obj.grabbed) {
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = 'bold 10px Inter, Arial';
    ctx.textAlign = 'center';
    ctx.fillText('+' + obj.points, obj.x + obj.width / 2, obj.y - 5);
    ctx.textAlign = 'left';
  }
}

function drawHUD() {
  ctx.fillStyle = '#e2e8f0';
  ctx.font = 'bold 16px Inter, Arial';
  ctx.textAlign = 'left';
  ctx.fillText('Score: ' + score, 15, canvas.height - 15);
  ctx.textAlign = 'right';
  ctx.fillStyle = '#94a3b8';
  ctx.font = '13px Inter, Arial';
  ctx.fillText('Caught: ' + caughtCount, canvas.width - 15, canvas.height - 15);
  ctx.textAlign = 'left';

  if (controlledArm.holdingObject) {
    ctx.fillStyle = '#10b981';
    ctx.font = 'bold 13px Inter, Arial';
    ctx.fillText('Holding: ' + controlledArm.holdingObject.label, 15, canvas.height - 35);
  }

  // Speed indicator
  ctx.fillStyle = '#94a3b8';
  ctx.font = '11px Inter, Arial';
  ctx.textAlign = 'right';
  ctx.fillText('Speed: ' + conveyorSpeed.toFixed(1) + 'x', canvas.width - 15, canvas.height - 35);
  ctx.fillText('Catch zone: ' + Math.round(catchRadius) + 'px', canvas.width - 15, canvas.height - 50);
  ctx.textAlign = 'left';

  // Aim crosshair (disappears after 3 catches)
  const sx = getShoulderX(controlledArm);
  if (caughtCount < 3 && !controlledArm.reaching && !controlledArm.retracting && gameRunning) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,100,100,0.35)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(sx, robot.torsoBottom + 10);
    ctx.lineTo(sx, conveyor.y - 5);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(255,100,100,0.5)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(sx, conveyor.y - 15, Math.max(catchRadius * 0.4, 5), 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(sx - catchRadius * 0.5, conveyor.y - 15);
    ctx.lineTo(sx + catchRadius * 0.5, conveyor.y - 15);
    ctx.stroke();
    ctx.restore();
  }

  // Show "aim removed" hint once
  if (caughtCount === 3) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, 1 - (frameCount % 200) / 100);
    ctx.fillStyle = '#f59e0b';
    ctx.font = '14px Inter, Arial';
    ctx.textAlign = 'center';
    ctx.fillText('Aim assist removed! You\'re on your own now.', canvas.width / 2, 445);
    ctx.restore();
  }
}

// === Score popups ===
function showPopup(x, y, text, color) {
  popups.push({ x, y, text, life: 50, color: color || '#10b981' });
}
function updatePopups() {
  popups.forEach(p => { p.y -= 1.2; p.life--; });
  popups = popups.filter(p => p.life > 0);
}
function drawPopups() {
  popups.forEach(p => {
    ctx.save();
    ctx.globalAlpha = p.life / 50;
    ctx.fillStyle = p.color;
    ctx.font = 'bold 22px Inter, Arial';
    ctx.textAlign = 'center';
    ctx.fillText(p.text, p.x, p.y);
    ctx.restore();
  });
}

// === Update ===
function update() {
  frameCount++;
  idleWavePhase += 0.025;

  // Move robot left/right (only when not reaching)
  if (!controlledArm.reaching && !controlledArm.retracting) {
    if (keys['ArrowLeft'])  robot.x = Math.max(100, robot.x - robot.moveSpeed);
    if (keys['ArrowRight']) robot.x = Math.min(canvas.width - 100, robot.x + robot.moveSpeed);
  }

  // --- Controlled arm reaching ---
  updateArmReach(controlledArm, true);

  // Move belt objects
  objects.forEach(obj => { if (!obj.grabbed) obj.x += conveyorSpeed; });

  // Remove objects off-screen (no penalty)
  objects = objects.filter(obj => {
    if (!obj.grabbed && obj.x > canvas.width + 50) return false;
    return true;
  });

  // Spawn
  spawnTimer++;
  if (spawnTimer >= spawnInterval) {
    spawnTimer = 0;
    spawnObject();
    if (conveyorSpeed < 5.0) conveyorSpeed += 0.03;
    if (spawnInterval > 45) spawnInterval -= 0.5;
    if (catchRadius > MIN_CATCH_RADIUS) catchRadius -= 0.25;
  }
}

function updateArmReach(arm, isControlled) {
  const sx = getShoulderX(arm);

  if (arm.reaching) {
    arm.reachProgress = Math.min(1, arm.reachProgress + arm.reachSpeed);
    if (arm.reachProgress >= 1) {
      arm.gripClosed = true;
      let caught = false;
      for (let i = objects.length - 1; i >= 0; i--) {
        const obj = objects[i];
        if (obj.grabbed || obj.scored) continue;
        const objCx = obj.x + obj.width / 2;
        const dist = Math.abs(sx - objCx);
        if (dist < catchRadius) {
          obj.grabbed = true;
          arm.holdingObject = obj;
          caught = true;
          break;
        }
      }
      if (!caught && isControlled) {
        arm.reaching = false;
        arm.retracting = true;
        setTimeout(() => {
          gameOver = true;
          gameRunning = false;
          if (score > highScore) {
            highScore = score;
            localStorage.setItem('catchGameHighScore', highScore);
            document.getElementById('gameHighScore').textContent = highScore;
          }
        }, 400);
        showPopup(sx, arm.catchY - 40, 'MISS!', '#ef4444');
      } else {
        arm.reaching = false;
        arm.retracting = true;
      }
    }
  }

  if (arm.retracting) {
    arm.reachProgress = Math.max(0, arm.reachProgress - arm.reachSpeed);
    if (arm.reachProgress <= 0) {
      arm.retracting = false;
      if (arm.holdingObject) {
        score += arm.holdingObject.points;
        caughtCount++;
        document.getElementById('gameScore').textContent = score;
        showPopup(sx, arm.restY, '+' + arm.holdingObject.points, '#10b981');
        objects = objects.filter(o => o !== arm.holdingObject);
        arm.holdingObject = null;
      }
      arm.gripClosed = false;
    }
  }

  // Move held object with hand
  if (arm.holdingObject) {
    const sy = robot.torsoTop + 5;
    const handY = arm.restY + (arm.catchY - arm.restY) * arm.reachProgress;
    arm.holdingObject.x = sx - arm.holdingObject.width / 2;
    arm.holdingObject.y = handY - arm.holdingObject.height / 2;
  }
}

// === Catch attempt ===
function tryCatch() {
  if (controlledArm.reaching || controlledArm.retracting || controlledArm.holdingObject) return;
  controlledArm.reaching = true;
  controlledArm.reachProgress = 0;
  controlledArm.gripClosed = false;
}

// === Draw ===
function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawBackground();
  drawConveyor();
  drawRail();

  // Draw belt objects
  objects.forEach(obj => { if (!obj.grabbed) drawObject(obj); });

  // --- Draw arms behind body ---
  // Right (idle) arm — sticking out to the side
  const idleSx = getShoulderX(idleArm);
  const idleSy = robot.torsoTop + 5;
  const idleTargetX = idleSx + (idleArm.side === 'right' ? 80 : -80) + Math.sin(idleWavePhase) * 15;
  const idleTargetY = idleSy + 70 + Math.cos(idleWavePhase * 0.7) * 20;
  const idleIK = solveIK(idleSx, idleSy, idleTargetX, idleTargetY, idleArm.upperLen, idleArm.lowerLen);
  drawOneArm(idleArm, idleIK.shoulderAngle, -idleIK.elbowAngle, false);

  // Left (controlled) arm
  const ctrlSx = getShoulderX(controlledArm);
  const ctrlSy = robot.torsoTop + 5;
  const ctrlHandY = controlledArm.restY + (controlledArm.catchY - controlledArm.restY) * controlledArm.reachProgress;
  const ctrlIK = solveIK(ctrlSx, ctrlSy, ctrlSx, ctrlHandY, controlledArm.upperLen, controlledArm.lowerLen);
  drawOneArm(controlledArm, ctrlIK.shoulderAngle, ctrlIK.elbowAngle, true);

  // --- Draw body on top ---
  drawRobotBody();

  // Draw held objects on top
  if (controlledArm.holdingObject) drawObject(controlledArm.holdingObject);

  drawPopups();
  drawHUD();

  // Start screen
  if (!gameRunning && !gameOver) {
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#e2e8f0';
    ctx.font = 'bold 32px Inter, Arial';
    ctx.textAlign = 'center';
    ctx.fillText('Catch the Blue Can Challenge!', canvas.width / 2, canvas.height / 2 - 65);
    ctx.font = '16px Inter, Arial';
    ctx.fillStyle = '#94a3b8';
    ctx.fillText('← →  Move robot along rail', canvas.width / 2, canvas.height / 2 - 20);
    ctx.fillText('SPACE  Reach down & catch!', canvas.width / 2, canvas.height / 2 + 8);
    ctx.fillText('Miss a catch = Game Over', canvas.width / 2, canvas.height / 2 + 36);
    ctx.font = '13px Inter, Arial';
    ctx.fillStyle = '#f59e0b';
    ctx.fillText('Belt speeds up · Catch zone shrinks · Aim vanishes after 3 catches', canvas.width / 2, canvas.height / 2 + 68);
    ctx.font = '15px Inter, Arial';
    ctx.fillStyle = '#10b981';
    ctx.fillText('Press SPACE or click Start Game', canvas.width / 2, canvas.height / 2 + 100);
    ctx.textAlign = 'left';
  }

  // Game over screen
  if (gameOver) {
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#ef4444';
    ctx.font = 'bold 44px Inter, Arial';
    ctx.textAlign = 'center';
    ctx.fillText('GAME OVER', canvas.width / 2, canvas.height / 2 - 55);
    ctx.fillStyle = '#e2e8f0';
    ctx.font = '24px Inter, Arial';
    ctx.fillText('Score: ' + score, canvas.width / 2, canvas.height / 2 + 5);
    ctx.fillStyle = '#f59e0b';
    ctx.font = '17px Inter, Arial';
    ctx.fillText('Caught: ' + caughtCount + '  |  Speed: ' + conveyorSpeed.toFixed(1) + 'x  |  High Score: ' + highScore, canvas.width / 2, canvas.height / 2 + 42);
    ctx.font = '15px Inter, Arial';
    ctx.fillStyle = '#94a3b8';
    ctx.fillText('Press R or click Start Game to try again', canvas.width / 2, canvas.height / 2 + 90);
    ctx.textAlign = 'left';
  }
}

// === Loop ===
function gameLoop() {
  if (gameRunning && !gameOver) { update(); updatePopups(); }
  draw();
  requestAnimationFrame(gameLoop);
}

// === Start / Reset ===
function startGame() {
  gameRunning = true;
  gameOver = false;
  score = 0;
  caughtCount = 0;
  conveyorSpeed = 1.5;
  spawnInterval = 120;
  spawnTimer = 0;
  frameCount = 0;
  catchRadius = 32;
  objects = [];
  popups = [];
  robot.x = 400;
  controlledArm.reaching = false;
  controlledArm.retracting = false;
  controlledArm.reachProgress = 0;
  controlledArm.holdingObject = null;
  controlledArm.gripClosed = false;
  idleArm.reaching = false;
  idleArm.retracting = false;
  idleArm.reachProgress = 0;
  idleArm.holdingObject = null;
  idleArm.gripClosed = false;
  idleWavePhase = 0;
  document.getElementById('gameScore').textContent = score;
  spawnTimer = spawnInterval - 40;
}

// === Controls ===
document.addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (e.code === 'Space') {
    e.preventDefault();
    if (!gameRunning && !gameOver) startGame();
    else if (gameRunning && !gameOver) tryCatch();
  }
  if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)) e.preventDefault();
  if (e.key === 'r' || e.key === 'R') startGame();
});
document.addEventListener('keyup', (e) => { keys[e.code] = false; });
canvas.addEventListener('click', () => {
  if (!gameRunning || gameOver) startGame();
});

gameLoop();
