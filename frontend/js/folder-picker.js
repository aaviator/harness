import { api } from "./api.js";

export class FolderPicker {
  constructor(containerId, onSelect) {
    this.container = document.getElementById(containerId);
    this.onSelect = onSelect;
    this.cache = {};
  }

  async init(rootPath) {
    this.cache = {};
    this.container.innerHTML = "";
    const { node, arrow, children, setExpanded } = this._makeNode(rootPath, true);
    this.container.appendChild(node);
    // Auto-expand root
    setExpanded(true);
    await this._expand(rootPath, node);
  }

  _makeNode(path, isRoot = false) {
    const div = document.createElement("div");
    div.className = "folder-node";
    div.dataset.path = path;

    const row = document.createElement("div");
    row.className = "flex items-center gap-1 py-0.5 px-2 rounded cursor-pointer hover:bg-slate-700 group";

    const arrow = document.createElement("span");
    arrow.className = "text-slate-500 w-3 text-xs select-none transition-transform duration-150";
    arrow.textContent = "▶";

    const icon = document.createElement("span");
    icon.textContent = "📁";
    icon.className = "text-sm";

    const label = document.createElement("span");
    label.className = "text-slate-300 text-sm font-mono truncate flex-1";
    label.textContent = isRoot ? path : path.split("/").pop();
    label.title = path;

    const selectBtn = document.createElement("button");
    selectBtn.className = "hidden group-hover:flex items-center text-xs text-blue-400 hover:text-blue-300 px-1";
    selectBtn.textContent = "Select";
    selectBtn.onclick = (e) => { e.stopPropagation(); this.onSelect(path); };

    row.appendChild(arrow);
    row.appendChild(icon);
    row.appendChild(label);
    row.appendChild(selectBtn);

    const children = document.createElement("div");
    children.className = "pl-4 hidden";

    div.appendChild(row);
    div.appendChild(children);

    let expanded = false;
    let loading = false;

    const setExpanded = (val) => {
      expanded = val;
      arrow.style.transform = val ? "rotate(90deg)" : "";
      children.classList.toggle("hidden", !val);
    };

    row.onclick = async (e) => {
      if (e.target === selectBtn) return;
      if (loading) return;
      setExpanded(!expanded);
      if (expanded && !this.cache[path]) {
        loading = true;
        arrow.textContent = "⋯";
        try {
          await this._expand(path, div);
        } finally {
          loading = false;
          arrow.textContent = "▶";
          arrow.style.transform = "rotate(90deg)";
        }
      }
    };

    return { node: div, arrow, children, setExpanded };
  }

  async _expand(path, parentNode) {
    if (this.cache[path]) return;
    try {
      const res = await fetch(api.fsList(path));
      const data = await res.json();
      const childContainer = parentNode.querySelector(":scope > div.pl-4") || parentNode.querySelector(".pl-4");
      if (!childContainer) return;
      childContainer.innerHTML = "";
      const dirs = (data.entries || []).filter(e => e.isDir);
      if (dirs.length === 0) {
        childContainer.innerHTML = '<div class="text-slate-600 text-xs px-2 py-1">Empty</div>';
      }
      for (const entry of dirs) {
        const { node } = this._makeNode(entry.path);
        childContainer.appendChild(node);
      }
      this.cache[path] = true;
    } catch {
      const childContainer = parentNode.querySelector(".pl-4");
      if (childContainer) childContainer.innerHTML = '<div class="text-red-500 text-xs px-2">Error loading</div>';
    }
  }
}
