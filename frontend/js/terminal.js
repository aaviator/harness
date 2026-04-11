// xterm.js PTY WebSocket client

export class TerminalClient {
  constructor(containerId) {
    this.containerId = containerId;
    this.term = null;
    this.fitAddon = null;
    this.ws = null;
    this.dir = null;
    this.session = null;
  }

  init(dir, session = null) {
    this.dir = dir;
    this.session = session;
    const container = document.getElementById(this.containerId);
    if (!container) return;

    // Init xterm
    this.term = new Terminal({
      theme: { background: "#0f172a", foreground: "#e2e8f0", cursor: "#38bdf8" },
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      cursorBlink: true,
      allowTransparency: true,
    });
    this.fitAddon = new FitAddon.FitAddon();
    this.term.loadAddon(this.fitAddon);
    this.term.open(container);
    this.fitAddon.fit();

    window.addEventListener("resize", () => this._fit());

    this._connect();
  }

  _fit() {
    if (!this.fitAddon || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.fitAddon.fit();
    const { cols, rows } = this.term;
    this.ws.send(JSON.stringify({ type: "resize", cols, rows }));
  }

  _connect() {
    if (!this.dir) return;
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const params = new URLSearchParams({ dir: this.dir });
    if (this.session) params.set("session", this.session);
    const url = `${proto}//${location.host}/ws/terminal?${params}`;

    this.ws = new WebSocket(url);
    this.ws.binaryType = "arraybuffer";

    this.ws.onopen = () => {
      this.term?.clear();
      this._fit();
    };

    this.ws.onmessage = (e) => {
      const data = typeof e.data === "string" ? e.data : new TextDecoder().decode(e.data);
      this.term?.write(data);
    };

    this.ws.onclose = () => {
      this.term?.write("\r\n\x1b[33m[connection closed]\x1b[0m\r\n");
    };

    this.ws.onerror = () => {
      this.term?.write("\r\n\x1b[31m[connection error]\x1b[0m\r\n");
    };

    this.term.onData((data) => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: "input", data }));
      }
    });
  }

  reset() {
    this.ws?.close();
    this.term?.clear();
    this._connect();
  }

  dispose() {
    this.ws?.close();
    this.term?.dispose();
    window.removeEventListener("resize", () => this._fit());
  }

  focus() {
    this.term?.focus();
  }
}
