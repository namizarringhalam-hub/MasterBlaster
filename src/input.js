const GAME_KEYS = new Set([
  "KeyW", "KeyA", "KeyS", "KeyD", "KeyE", "KeyQ", "KeyR",
  "Space", "Escape", "Tab", "Digit1", "Digit2", "Digit3", "Digit4", "Digit5"
]);

function editableTarget(target) {
  return Boolean(target?.closest?.("input, textarea, select, button, [contenteditable='true']"));
}

export function shouldCaptureGameKey(event, active) {
  const shortcut = (event.ctrlKey || event.metaKey || event.altKey) && !event.code.startsWith("Control");
  return active && GAME_KEYS.has(event.code) && !shortcut && !editableTarget(event.target);
}

export function updateOrbit(yaw, pitch, movementX, movementY, sensitivity = .0022) {
  return {
    yaw: yaw - movementX * sensitivity,
    pitch: Math.max(-.75, Math.min(.65, pitch - movementY * sensitivity))
  };
}

export function touchLookDelta(fromX, fromY, toX, toY) {
  return {
    x: Math.max(-80, Math.min(80, toX - fromX)),
    y: Math.max(-80, Math.min(80, toY - fromY))
  };
}

export function touchMoveDelta(fromX, fromY, toX, toY, range = 72, deadZone = 8) {
  const x = toX - fromX;
  const y = toY - fromY;
  const distance = Math.hypot(x, y);
  if (distance <= deadZone) return { x: 0, y: 0 };
  const scale = Math.min(1, (distance - deadZone) / Math.max(1, range - deadZone)) / distance;
  return { x: x * scale, y: y * scale };
}

export function clearTouchActions(touch) {
  for (const action of Object.keys(touch || {})) touch[action] = false;
  return touch;
}

export class InputManager {
  constructor(canvas, shouldCapture = () => true, onPointerUnlock = () => {}) {
    this.shouldCapture = shouldCapture;
    this.keys = new Set();
    this.pressed = new Set();
    this.mouse = { left: false, right: false, movementX: 0, movementY: 0, locked: false };
    this.touchLook = null;
    this.touchMove = null;
    this.touchMoveValue = { x: 0, y: 0 };

    addEventListener("keydown", (event) => {
      if (!shouldCaptureGameKey(event, this.shouldCapture())) return;
      if (!this.keys.has(event.code)) this.pressed.add(event.code);
      this.keys.add(event.code);
      event.preventDefault();
    });
    addEventListener("keyup", (event) => {
      this.keys.delete(event.code);
      if (shouldCaptureGameKey(event, this.shouldCapture())) event.preventDefault();
    });
    addEventListener("blur", () => {
      this.keys.clear();
      this.mouse.left = false;
      this.mouse.right = false;
      this.mouse.movementX = 0;
      this.mouse.movementY = 0;
      this.resetTouches();
    });
    addEventListener("pointermove", (event) => {
      if (event.pointerType === "touch") {
        if (this.touchMove?.id === event.pointerId) {
          Object.assign(this.touchMoveValue, touchMoveDelta(this.touchMove.x, this.touchMove.y, event.clientX, event.clientY));
        } else if (this.touchLook?.id === event.pointerId) {
          const movement = touchLookDelta(this.touchLook.x, this.touchLook.y, event.clientX, event.clientY);
          this.mouse.movementX += movement.x;
          this.mouse.movementY += movement.y;
          this.touchLook.x = event.clientX;
          this.touchLook.y = event.clientY;
        } else return;
        event.preventDefault();
        return;
      }
      if (document.pointerLockElement !== canvas) return;
      this.mouse.movementX += Math.max(-80, Math.min(80, event.movementX));
      this.mouse.movementY += Math.max(-80, Math.min(80, event.movementY));
    });
    document.addEventListener("pointerlockchange", () => {
      const wasLocked = this.mouse.locked;
      this.mouse.locked = document.pointerLockElement === canvas;
      this.mouse.movementX = 0;
      this.mouse.movementY = 0;
      if (!this.mouse.locked) this.mouse.left = this.mouse.right = false;
      if (wasLocked && !this.mouse.locked) onPointerUnlock();
    });
    canvas.addEventListener("pointerdown", (event) => {
      if (!this.shouldCapture()) return;
      if (event.pointerType === "touch") {
        const bounds = canvas.getBoundingClientRect?.();
        const midpoint = bounds?.width ? bounds.left + bounds.width / 2 : (canvas.clientWidth || globalThis.innerWidth || 0) / 2;
        if (event.clientX < midpoint) {
          if (this.touchMove) return;
          this.touchMove = { id: event.pointerId, x: event.clientX, y: event.clientY };
          this.touchMoveValue.x = this.touchMoveValue.y = 0;
        } else {
          if (this.touchLook) return;
          this.touchLook = { id: event.pointerId, x: event.clientX, y: event.clientY };
        }
        canvas.setPointerCapture?.(event.pointerId);
        event.preventDefault();
        return;
      }
      if (document.pointerLockElement !== canvas) canvas.requestPointerLock?.();
      if (event.button === 0) {
        this.mouse.left = true;
        this.pressed.add("MouseLeft");
      }
      if (event.button === 2) {
        this.mouse.right = true;
        this.pressed.add("MouseRight");
      }
      event.preventDefault();
    });
    addEventListener("pointerup", (event) => {
      if (event.pointerType === "touch") {
        this.releaseTouch(event.pointerId);
        event.preventDefault();
        return;
      }
      if (event.button === 0) this.mouse.left = false;
      if (event.button === 2) this.mouse.right = false;
    });
    addEventListener("pointercancel", (event) => {
      this.releaseTouch(event.pointerId);
    });
    canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  }

  down(code) { return this.keys.has(code); }
  tapped(code) { return this.pressed.has(code); }
  consumeLook() {
    const movement = { x: this.mouse.movementX, y: this.mouse.movementY };
    this.mouse.movementX = 0;
    this.mouse.movementY = 0;
    return movement;
  }
  touchDirection() { return this.touchMoveValue; }
  releaseTouch(pointerId) {
    if (this.touchMove?.id === pointerId) {
      this.touchMove = null;
      this.touchMoveValue.x = this.touchMoveValue.y = 0;
    }
    if (this.touchLook?.id === pointerId) this.touchLook = null;
  }
  resetTouches() {
    this.touchMove = this.touchLook = null;
    this.touchMoveValue.x = this.touchMoveValue.y = 0;
  }
  releasePointer() {
    if (document.pointerLockElement) document.exitPointerLock?.();
    this.resetTouches();
  }
  endFrame() {
    this.pressed.clear();
    if (!this.shouldCapture()) {
      this.consumeLook();
      this.resetTouches();
    }
  }
}
