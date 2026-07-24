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

export class InputManager {
  constructor(canvas, shouldCapture = () => true) {
    this.shouldCapture = shouldCapture;
    this.keys = new Set();
    this.pressed = new Set();
    this.mouse = { x: 0, y: 0, left: false, right: false };

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
    });
    addEventListener("pointermove", (event) => {
      if (event.pointerType === "touch") return;
      const rect = canvas.getBoundingClientRect();
      this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      this.mouse.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
    });
    canvas.addEventListener("pointerdown", (event) => {
      if (!this.shouldCapture()) return;
      if (event.button === 0) this.mouse.left = true;
      if (event.button === 2) {
        this.mouse.right = true;
        this.pressed.add("MouseRight");
      }
      canvas.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    });
    addEventListener("pointerup", (event) => {
      if (event.button === 0) this.mouse.left = false;
      if (event.button === 2) this.mouse.right = false;
    });
    canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  }

  down(code) { return this.keys.has(code); }
  tapped(code) { return this.pressed.has(code); }
  endFrame() { this.pressed.clear(); }
}
