import "./panel.css";

/* A settings sheet for the demos.
 *
 * It docks to the bottom of the page and the scene shrinks to the space above it. Folders become tabs, the controls of
 * a tab sit in a grid of columns, and a slider is the whole row: the label on the left, the value on the right, the fill
 * behind them. The page also gets four buttons in the top right corner: the source, the theme, the sheet itself, reset.
 *
 * The API copies the part of lil-gui the demos use (addFolder, add, addColor, name, onChange, onFinishChange, listen,
 * updateDisplay, controllersRecursive, show, open, close), so a demo describes its settings exactly as before.
 *
 *   const gui = new GUI({ title: "Overgrowth", repo: "https://github.com/…", onReset: () => load(DEFAULTS) });
 *   const moss = gui.addFolder("Moss");
 *   moss.add(settings, "pile", 0.3, 2.5, 0.01).name("pile length").onChange(apply);
 *
 * The scene asks stageSize() for its size: the window minus the open sheet. Opening and closing the sheet fires a
 * window resize, so the usual resize handler is enough. */

const PHONE = "(max-width: 720px)";
const THEME_KEY = "panel-theme";
const ARROW = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 17 7M9 7h8v8"/></svg>';
const MOON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5Z"/></svg>';
const SUN = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/></svg>';
const SLIDERS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>';
const UNDO = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 9h10a5 5 0 0 1 0 10H9"/><path d="M8 5 4 9l4 4"/></svg>';
const CHEVRON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg>';

let sheetHeight = 0;

/** The size the scene should draw at: the window minus the part the open sheet covers. */
export function stageSize() {
  return { width: innerWidth, height: Math.max(1, innerHeight - sheetHeight) };
}

const el = (tag, className, html) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html !== undefined) node.innerHTML = html;
  return node;
};

/* "sun height, °" → a label and a unit; the unit goes after the value, like "45°" or "12 s" */
function splitUnit(name) {
  const match = /^(.*),\s*([^\s,]{1,3})$/.exec(name);
  return match ? { label: match[1], unit: match[2] } : { label: name, unit: "" };
}
/* "pile length" → "Pile length"; a bare property name like "wetDarken" → "Wet darken" */
const capital = (text) => {
  const words = /^[a-z]+[A-Z]/.test(text) && !text.includes(" ") ? text.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase() : text;
  return words.charAt(0).toUpperCase() + words.slice(1);
};
const decimalsOf = (step) => {
  if (!step || step >= 1) return 0;
  const text = String(step);
  return text.includes("e-") ? Number(text.split("e-")[1]) : (text.split(".")[1] || "").length;
};

/* ── controllers ─────────────────────────────────────────────────────────────────────────────────────────────── */

class Controller {
  constructor(parent, object, property, kind) {
    this.parent = parent;
    this.object = object;
    this.property = property;
    this.kind = kind;
    this._name = property;
    this._onChange = null;
    this._onFinishChange = null;
    this._listening = false;
    this.domElement = el("div", `pnl-ctrl pnl-ctrl--${kind}`);
    this.initialValue = this.getValue();
  }
  getValue() { return this.object[this.property]; }
  setValue(value) {
    this.object[this.property] = value;
    this.updateDisplay();
    this._onChange?.call(this, value);
    return this;
  }
  finish() { this._onFinishChange?.call(this, this.getValue()); }
  name(text) { this._name = text; this.renderName(); return this; }
  renderName() {}
  onChange(callback) { this._onChange = callback; return this; }
  onFinishChange(callback) { this._onFinishChange = callback; return this; }
  listen(on = true) { this._listening = on; this.parent.root.listenTo(this, on); return this; }
  updateDisplay() { return this; }
  show(on = true) { this.domElement.hidden = !on; return this; }
  hide() { return this.show(false); }
  reset() { return this.setValue(this.initialValue); }
}

/* A number with a range: the whole row is the slider. Drag or click anywhere on it, arrows step it, double click types
   a value. */
class NumberController extends Controller {
  constructor(parent, object, property, min, max, step) {
    super(parent, object, property, "number");
    this._min = min; this._max = max; this._step = step ?? (max - min) / 100;
    const row = this.row = el("div", "pnl-slider");
    row.tabIndex = 0;
    row.setAttribute("role", "slider");
    this.fill = el("span", "pnl-slider__fill");
    this.label = el("span", "pnl-slider__label");
    this.value = el("span", "pnl-slider__value");
    row.append(this.fill, this.label, this.value);
    this.domElement.append(row);
    this.bind();
    this.renderName();
    this.updateDisplay();
  }
  min(value) { this._min = value; return this.updateDisplay(); }
  max(value) { this._max = value; return this.updateDisplay(); }
  step(value) { this._step = value; return this.updateDisplay(); }
  renderName() {
    const { label, unit } = splitUnit(this._name);
    this.unit = unit;
    this.label.textContent = capital(label);
    this.row.setAttribute("aria-label", capital(label));
    this.updateDisplay();
  }
  snap(value) {
    const stepped = Math.round((value - this._min) / this._step) * this._step + this._min;
    return Number(Math.min(this._max, Math.max(this._min, stepped)).toFixed(10));
  }
  format(value) {
    const decimals = decimalsOf(this._step);
    /* 380000 reads as 380,000 */
    const text = decimals === 0 && Math.abs(value) >= 10000 ? Math.round(value).toLocaleString("en-US") : Number(value).toFixed(decimals);
    if (!this.unit) return text;
    return /^[°%]$/.test(this.unit) ? text + this.unit : `${text} ${this.unit}`;
  }
  updateDisplay() {
    if (!this.fill) return this;
    const value = this.getValue();
    const share = (value - this._min) / (this._max - this._min || 1);
    this.fill.style.width = `${Math.min(1, Math.max(0, share)) * 100}%`;
    this.value.textContent = this.format(value);
    this.row.setAttribute("aria-valuemin", this._min);
    this.row.setAttribute("aria-valuemax", this._max);
    this.row.setAttribute("aria-valuenow", value);
    this.row.setAttribute("aria-valuetext", this.format(value));
    return this;
  }
  bind() {
    const row = this.row;
    let rect = null, moved = false, startX = 0;
    const at = (x) => this._min + (x - rect.left) / rect.width * (this._max - this._min);
    row.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || this.editing) return;
      rect = row.getBoundingClientRect(); moved = false; startX = event.clientX;
      row.setPointerCapture(event.pointerId);
      row.classList.add("is-active");
    });
    row.addEventListener("pointermove", (event) => {
      if (!rect) return;
      if (!moved && Math.abs(event.clientX - startX) < 3) return;
      moved = true;
      const next = this.snap(at(event.clientX));
      if (next !== this.getValue()) this.setValue(next);
    });
    const end = (event) => {
      if (!rect) return;
      if (!moved && event.type === "pointerup") {
        const next = this.snap(at(event.clientX));
        if (next !== this.getValue()) this.setValue(next);
      }
      rect = null;
      row.classList.remove("is-active");
      this.finish();
    };
    row.addEventListener("pointerup", end);
    row.addEventListener("pointercancel", end);
    row.addEventListener("dblclick", () => this.edit());
    row.addEventListener("keydown", (event) => {
      const big = event.shiftKey ? 10 : 1;
      const keys = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 };
      if (event.key in keys) {
        event.preventDefault();
        this.setValue(this.snap(this.getValue() + keys[event.key] * this._step * big));
        this.finish();
      } else if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        this.setValue(event.key === "Home" ? this._min : this._max);
        this.finish();
      } else if (event.key === "Enter") {
        event.preventDefault();
        this.edit();
      }
    });
  }
  /* typing a value: an input over the value, Enter or leaving it applies, Esc cancels */
  edit() {
    if (this.editing) return;
    this.editing = true;
    const input = el("input", "pnl-slider__input");
    input.type = "text";
    input.inputMode = "decimal";
    input.value = Number(this.getValue()).toFixed(decimalsOf(this._step));
    this.value.replaceChildren(input);
    input.focus();
    input.select();
    const done = (apply) => {
      if (!this.editing) return;
      this.editing = false;
      const typed = parseFloat(input.value.replace(",", "."));
      if (apply && Number.isFinite(typed)) { this.setValue(this.snap(typed)); this.finish(); }
      this.updateDisplay();
      this.row.focus();
    };
    input.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Enter") done(true);
      if (event.key === "Escape") done(false);
    });
    input.addEventListener("blur", () => done(true));
  }
}

/* A number without a range: a plain field. */
class FieldController extends Controller {
  constructor(parent, object, property, numeric) {
    super(parent, object, property, "field");
    this.numeric = numeric;
    const row = el("label", "pnl-field");
    this.label = el("span", "pnl-field__label");
    this.input = el("input", "pnl-field__input");
    this.input.type = "text";
    this.input.spellcheck = false;
    if (numeric) this.input.inputMode = "decimal";
    row.append(this.label, this.input);
    this.domElement.append(row);
    this.input.addEventListener("input", () => {
      if (!numeric) this.setValue(this.input.value);
    });
    this.input.addEventListener("change", () => {
      if (numeric) {
        const typed = parseFloat(this.input.value.replace(",", "."));
        if (Number.isFinite(typed)) this.setValue(typed);
      }
      this.finish();
    });
    this.input.addEventListener("keydown", (event) => event.stopPropagation());
    this.renderName();
    this.updateDisplay();
  }
  renderName() { this.label.textContent = capital(this._name); }
  updateDisplay() {
    if (document.activeElement !== this.input) this.input.value = String(this.getValue());
    return this;
  }
}

class BooleanController extends Controller {
  constructor(parent, object, property) {
    super(parent, object, property, "boolean");
    const row = this.row = el("button", "pnl-toggle");
    row.type = "button";
    row.setAttribute("role", "switch");
    this.label = el("span", "pnl-toggle__label");
    row.append(this.label, el("span", "pnl-toggle__switch", "<i></i>"));
    this.domElement.append(row);
    row.addEventListener("click", () => { this.setValue(!this.getValue()); this.finish(); });
    this.renderName();
    this.updateDisplay();
  }
  renderName() { this.label.textContent = capital(this._name); }
  updateDisplay() { this.row.setAttribute("aria-checked", String(Boolean(this.getValue()))); return this; }
}

/* A choice from a list: the label above, the native select below it, so phones get their own picker. */
class OptionController extends Controller {
  constructor(parent, object, property, options) {
    super(parent, object, property, "option");
    const wrap = el("label", "pnl-select");
    this.label = el("span", "pnl-select__label");
    const box = el("span", "pnl-select__box");
    this.select = el("select", "pnl-select__input");
    box.append(this.select, el("span", "pnl-select__chevron", CHEVRON));
    wrap.append(this.label, box);
    this.domElement.append(wrap);
    this.select.addEventListener("change", () => {
      this.setValue(this.values[this.select.selectedIndex]);
      this.finish();
    });
    this.options(options);
    this.renderName();
  }
  options(options) {
    const entries = Array.isArray(options) ? options.map((value) => [String(value), value]) : Object.entries(options);
    this.values = entries.map(([, value]) => value);
    this.select.replaceChildren(...entries.map(([label]) => { const option = el("option"); option.textContent = label; return option; }));
    return this.updateDisplay();
  }
  renderName() { this.label.textContent = capital(this._name); }
  updateDisplay() {
    if (!this.values) return this;
    const index = this.values.indexOf(this.getValue());
    this.select.selectedIndex = Math.max(0, index);
    return this;
  }
}

/* A colour: the row shows the hex and a swatch, the swatch is the native colour picker. */
class ColorController extends Controller {
  constructor(parent, object, property) {
    super(parent, object, property, "color");
    const row = el("label", "pnl-color");
    this.label = el("span", "pnl-color__label");
    this.hex = el("span", "pnl-color__hex");
    const swatch = el("span", "pnl-color__swatch");
    this.input = el("input", "pnl-color__input");
    this.input.type = "color";
    swatch.append(this.input);
    row.append(this.label, this.hex, swatch);
    this.domElement.append(row);
    this.swatch = swatch;
    this.input.addEventListener("input", () => this.setValue(this.input.value));
    this.input.addEventListener("change", () => this.finish());
    this.renderName();
    this.updateDisplay();
  }
  renderName() { this.label.textContent = capital(this._name); }
  updateDisplay() {
    const value = String(this.getValue());
    this.input.value = value;
    this.hex.textContent = value.toUpperCase();
    this.swatch.style.background = value;
    return this;
  }
}

class FunctionController extends Controller {
  constructor(parent, object, property) {
    super(parent, object, property, "function");
    this.button = el("button", "pnl-button");
    this.button.type = "button";
    this.domElement.append(this.button);
    this.button.addEventListener("click", () => {
      this.getValue().call(this.object);
      this._onChange?.call(this, this.getValue());
      this.finish();
    });
    this.renderName();
  }
  renderName() { this.button.textContent = capital(this._name); }
}

/* ── folders and the sheet ───────────────────────────────────────────────────────────────────────────────────── */

class Folder {
  constructor(parent, title) {
    this.parent = parent;
    this.root = parent ? parent.root : this;
    this._title = title;
    this.controllers = [];
    this.folders = [];
    this.grid = el("div", "pnl-grid");
  }
  add(object, property, a, b, c) {
    const value = object[property];
    let controller;
    if (Array.isArray(a) || (a && typeof a === "object")) controller = new OptionController(this, object, property, a);
    else if (typeof value === "boolean") controller = new BooleanController(this, object, property);
    else if (typeof value === "function") controller = new FunctionController(this, object, property);
    else if (typeof value === "number" && typeof a === "number" && typeof b === "number") controller = new NumberController(this, object, property, a, b, c);
    else controller = new FieldController(this, object, property, typeof value === "number");
    return this.adopt(controller);
  }
  addColor(object, property) { return this.adopt(new ColorController(this, object, property)); }
  adopt(controller) {
    this.controllers.push(controller);
    this.grid.append(controller.domElement);
    this.root.refreshTabs?.();
    return controller;
  }
  addFolder(title) {
    const folder = new Folder(this.root, title);
    this.root.folders.push(folder);
    this.root.mountFolder(folder);
    return folder;
  }
  title(text) { this._title = text; this.root.refreshTabs?.(); return this; }
  controllersRecursive() { return [...this.controllers, ...this.folders.flatMap((folder) => folder.controllersRecursive())]; }
  /* a folder is a tab, so there is nothing to fold: open() selects it, close() keeps the API */
  open() { this.root.select?.(this); return this; }
  close() { return this; }
  show() { return this; }
  hide() { return this; }
}

export default class GUI extends Folder {
  constructor({ title = "Settings", repo = "", onReset = null, rootTitle = "Presets", theme = "light", open } = {}) {
    super(null, rootTitle);
    this.appTitle = title;
    this.listened = new Set();
    this.tabs = [this];
    this.current = this;
    this.isOpen = open ?? !matchMedia(PHONE).matches;
    this.buildSheet();
    this.buildBar(repo, onReset, theme);
    this.mountFolder(this);
    this.select(this);
    this.applyOpen(false);
    /* the sheet grows as controls are added and when the window changes; the scene follows */
    new ResizeObserver(() => this.measure()).observe(this.domElement);
  }

  buildSheet() {
    const sheet = this.domElement = el("section", "pnl-sheet");
    sheet.setAttribute("aria-label", `${this.appTitle} settings`);
    const handle = this.handle = el("button", "pnl-handle", "<i></i>");
    handle.type = "button";
    handle.addEventListener("click", () => this.show(false));
    this.tabList = el("div", "pnl-tabs");
    this.tabList.setAttribute("role", "tablist");
    this.body = el("div", "pnl-body");
    sheet.append(handle, this.tabList, this.body);
    document.body.append(sheet);
  }

  buildBar(repo, onReset, theme) {
    const bar = el("nav", "pnl-bar");
    bar.setAttribute("aria-label", "Page");
    if (repo) {
      const link = el("a", "pnl-pill pnl-pill--strong", `<span>GitHub</span>${ARROW}`);
      link.href = repo; link.target = "_blank"; link.rel = "noopener";
      bar.append(link);
    }
    const themeButton = this.themeButton = el("button", "pnl-pill");
    themeButton.type = "button";
    themeButton.addEventListener("click", () => this.setTheme(this.theme === "dark" ? "light" : "dark"));
    const settings = this.settingsButton = el("button", "pnl-pill", `${SLIDERS}<span>Settings</span>`);
    settings.type = "button";
    settings.setAttribute("aria-controls", "pnl-sheet");
    settings.addEventListener("click", () => this.show(!this.isOpen));
    bar.append(themeButton, settings);
    if (onReset) {
      const reset = el("button", "pnl-pill", `${UNDO}<span>Reset</span>`);
      reset.type = "button";
      reset.addEventListener("click", () => onReset());
      bar.append(reset);
    }
    this.domElement.id = "pnl-sheet";
    document.body.append(bar);
    let saved = null;
    try { saved = localStorage.getItem(THEME_KEY); } catch { /* storage can be blocked */ }
    this.setTheme(saved === "dark" || saved === "light" ? saved : theme, false);
  }

  setTheme(theme, remember = true) {
    this.theme = theme;
    document.documentElement.dataset.panelTheme = theme;
    const next = theme === "dark" ? "Light theme" : "Dark theme";
    this.themeButton.innerHTML = `${theme === "dark" ? SUN : MOON}<span>${next}</span>`;
    this.themeButton.setAttribute("aria-label", next);
    if (remember) try { localStorage.setItem(THEME_KEY, theme); } catch { /* not kept, still applied */ }
  }

  mountFolder(folder) {
    const pane = el("div", "pnl-pane");
    pane.setAttribute("role", "tabpanel");
    pane.append(folder.grid);
    folder.pane = pane;
    pane.hidden = folder !== this.current;
    this.body.append(pane);
    if (folder !== this) this.tabs.push(folder);
    this.refreshTabs();
  }

  /* the root tab exists only when something was added to the root itself */
  refreshTabs() {
    if (!this.tabList) return;
    const visible = this.tabs.filter((folder) => folder !== this || folder.controllers.length);
    this.tabList.replaceChildren(...visible.map((folder) => {
      const tab = el("button", "pnl-tab");
      tab.type = "button";
      tab.setAttribute("role", "tab");
      tab.textContent = capital(folder._title);
      tab.setAttribute("aria-selected", String(folder === this.current));
      tab.addEventListener("click", () => this.select(folder));
      folder.tab = tab;
      return tab;
    }));
    if (this.current === this && !this.controllers.length && visible[0]) this.select(visible[0]);
  }

  select(folder) {
    this.current = folder;
    for (const tab of this.tabs) {
      if (tab.pane) tab.pane.hidden = tab !== folder;
      tab.tab?.setAttribute("aria-selected", String(tab === folder));
    }
    folder.tab?.scrollIntoView({ block: "nearest", inline: "nearest" });
    this.body.scrollTop = 0;
  }

  /* the open sheet takes its height off the scene; the scene hears about it as a window resize */
  measure() {
    const height = this.isOpen ? this.domElement.offsetHeight : 0;
    if (height === sheetHeight) return;
    sheetHeight = height;
    document.documentElement.style.setProperty("--pnl-sheet", `${height}px`);
    dispatchEvent(new Event("resize"));
  }
  applyOpen(notify = true) {
    this.domElement.classList.toggle("is-open", this.isOpen);
    this.domElement.inert = !this.isOpen;
    this.settingsButton.setAttribute("aria-expanded", String(this.isOpen));
    document.documentElement.classList.toggle("pnl-has-sheet", this.isOpen);
    if (notify || this.isOpen) this.measure();
    if (this.isOpen) this.poll();
  }

  get _hidden() { return !this.isOpen; }
  show(on = true) { this.isOpen = Boolean(on); this.applyOpen(); return this; }
  hide() { return this.show(false); }
  open() { return this.show(true); }
  close() { return this.show(false); }
  title(text) { this.appTitle = text; return this; }

  listenTo(controller, on) {
    if (on) this.listened.add(controller); else this.listened.delete(controller);
    this.poll();
  }
  /* listened values are read back while the sheet is open, a few times a second is plenty */
  poll() {
    if (this.polling || !this.isOpen || !this.listened.size) return;
    this.polling = true;
    const tick = () => {
      if (!this.isOpen || !this.listened.size) { this.polling = false; return; }
      for (const controller of this.listened) if (!controller.editing) controller.updateDisplay();
      setTimeout(tick, 120);
    };
    tick();
  }
}
