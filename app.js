// app.js
(() => {
  "use strict";

  // ---------------------------
  // Utilities
  // ---------------------------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const nowISO = () => new Date().toISOString();
  const fmt = (iso) => {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    // iPhone-friendly short format
    return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  };

  const toast = (() => {
    let t;
    let timer;
    function show(msg, ms = 900) {
      if (!t) t = $("#toast");
      if (!t) return;
      t.textContent = msg;
      t.style.display = "block";
      clearTimeout(timer);
      timer = setTimeout(() => {
        t.style.display = "none";
      }, ms);
    }
    return { show };
  })();

  // ---------------------------
  // IndexedDB (simple wrapper)
  // ---------------------------
  const DB_NAME = "log-it-yeet-it";
  const DB_VER = 1;
  const STORE = "entries";

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER);

      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: "id" });
          store.createIndex("created_at", "created_at", { unique: false });
          store.createIndex("item", "item", { unique: false });
        }
      };

      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function tx(mode, fn) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const store = t.objectStore(STORE);
      const res = fn(store, t);
      t.oncomplete = () => resolve(res);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }

  function uuid() {
    // Prefer crypto UUID if available
    if (crypto && crypto.randomUUID) return crypto.randomUUID();
    // Fallback
    return "id-" + Math.random().toString(16).slice(2) + "-" + Date.now().toString(16);
  }

  async function addEntry(entry) {
    await tx("readwrite", (store) => store.add(entry));
  }

  async function putEntry(entry) {
    await tx("readwrite", (store) => store.put(entry));
  }

  async function deleteEntry(id) {
    await tx("readwrite", (store) => store.delete(id));
  }

  async function getEntry(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const t = db.transaction(STORE, "readonly");
      const store = t.objectStore(STORE);
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function getAllEntries() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const t = db.transaction(STORE, "readonly");
      const store = t.objectStore(STORE);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function exportJSON() {
    const entries = await getAllEntries();
    // Sort newest first for readability
    entries.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
    return JSON.stringify({ exported_at: nowISO(), entries }, null, 2);
  }

  async function importJSON(jsonText) {
    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      throw new Error("Invalid JSON.");
    }
    const entries = Array.isArray(parsed?.entries) ? parsed.entries : null;
    if (!entries) throw new Error("JSON must include { entries: [...] }.");

    // Insert/overwrite safely
    for (const e of entries) {
      if (!e || typeof e !== "object") continue;
      if (!e.id) e.id = uuid();
      if (!e.created_at) e.created_at = nowISO();
      if (!("updated_at" in e)) e.updated_at = null;
      if (typeof e.item !== "string") e.item = String(e.item ?? "");
      if (typeof e.location !== "string") e.location = String(e.location ?? "");
      if (typeof e.inventory !== "string") e.inventory = String(e.inventory ?? "");
      if (typeof e.date !== "string") e.date = String(e.date ?? "");
      if (typeof e.notes !== "string") e.notes = String(e.notes ?? "");

      await putEntry(e);
    }
    return entries.length;
  }

  // ---------------------------
  // UI: Tabs/pages
  // ---------------------------
  function setActiveTab(tabName) {
    $$(".tab").forEach((b) => b.classList.toggle("is-active", b.dataset.tab === tabName));
    $$(".page").forEach((p) => p.classList.toggle("is-active", p.dataset.page === tabName));

    if (tabName === "master") renderMaster();
    if (tabName === "search") renderSearch();
    if (tabName === "log") {
      // Ensure "always blank on open" feel:
      // we won't wipe if user is mid-entry, but we will focus item for speed.
      $("#fItem")?.focus();
    }
  }

  function wireTabs() {
    $$(".tab").forEach((btn) => {
      btn.addEventListener("click", () => setActiveTab(btn.dataset.tab));
    });
    $$("[data-go]").forEach((btn) => {
      btn.addEventListener("click", () => setActiveTab(btn.dataset.go));
    });
  }

  // ---------------------------
  // LOG FORM
  // ---------------------------
  function resetLogForm() {
    const form = $("#logForm");
    if (!form) return;
    form.reset();
    const details = $("#notesDetails");
    if (details) details.open = false;
    $("#logStatus").textContent = "";
    $("#fItem")?.focus();
  }

  function wireLogForm() {
    const form = $("#logForm");
    if (!form) return;

    form.addEventListener("submit", async (e) => {
      e.preventDefault();

      const item = ($("#fItem").value || "").trim();
      const location = ($("#fLocation").value || "").trim();
      const inventory = ($("#fInventory").value || "").trim();
      const date = ($("#fDate").value || "").trim();
      const notes = ($("#fNotes").value || "").trim();

      if (!item) {
        $("#logStatus").textContent = "Item is required.";
        toast.show("Item required");
        $("#fItem")?.focus();
        return;
      }

      const entry = {
        id: uuid(),
        created_at: nowISO(),
        updated_at: null,
        item,
        location,
        inventory,
        date,
        notes
      };

      try {
        await addEntry(entry);
        toast.show("Yeeted.");
        resetLogForm();
      } catch (err) {
        console.error(err);
        $("#logStatus").textContent = "Save failed. Try again.";
        toast.show("Save failed");
      }
    });
  }

  // ---------------------------
  // MASTER LIST
  // ---------------------------
  function entrySummary(e) {
    const parts = [];
    if (e.location) parts.push(`📍 ${e.location}`);
    if (e.inventory) parts.push(`Count: ${e.inventory}`);
    if (e.date) parts.push(`Date: ${e.date}`);
    if (e.notes) parts.push(`Notes: ${e.notes}`);
    return parts.join(" • ");
  }

  function entryPills(e) {
    const pills = [];
    if (e.location) pills.push(e.location);
    if (e.inventory) pills.push(`Count ${e.inventory}`);
    if (e.date) pills.push(e.date);
    if (e.notes) pills.push("Notes");
    return pills;
  }

  function makeEntryCard(e) {
    const el = document.createElement("div");
    el.className = "item";

    const top = document.createElement("div");
    top.className = "item__top";

    const titleBtn = document.createElement("button");
    titleBtn.className = "link item__title";
    titleBtn.type = "button";
    titleBtn.textContent = e.item || "(no item)";
    titleBtn.addEventListener("click", () => openEdit(e.id));

    const meta = document.createElement("div");
    meta.className = "item__meta";
    meta.textContent = fmt(e.updated_at || e.created_at);

    top.appendChild(titleBtn);
    top.appendChild(meta);

    const sub = document.createElement("div");
    sub.className = "item__sub";
    sub.textContent = entrySummary(e) || "—";

    const pillRow = document.createElement("div");
    pillRow.className = "item__pillRow";
    for (const p of entryPills(e)) {
      const pill = document.createElement("span");
      pill.className = "pill";
      pill.textContent = p;
      pillRow.appendChild(pill);
    }

    el.appendChild(top);
    el.appendChild(sub);
    if (pillRow.childElementCount) el.appendChild(pillRow);

    return el;
  }

  async function renderMaster() {
    const list = $("#masterList");
    if (!list) return;

    let entries = [];
    try {
      entries = await getAllEntries();
    } catch (err) {
      console.error(err);
      list.textContent = "Could not load entries.";
      return;
    }

    entries.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
    $("#countMeta").textContent = `${entries.length} item(s)`;

    list.innerHTML = "";
    if (!entries.length) {
      const empty = document.createElement("div");
      empty.className = "item";
      empty.innerHTML = `<div class="item__title">Nothing yet.</div><div class="item__sub">Use “Put It Here” to YEET your first item.</div>`;
      list.appendChild(empty);
      return;
    }

    for (const e of entries) list.appendChild(makeEntryCard(e));
  }

  // ---------------------------
  // SEARCH
  // ---------------------------
  let searchCache = [];

  function matchesQuery(e, q) {
    if (!q) return true;
    const hay = `${e.item || ""} ${e.location || ""} ${e.notes || ""}`.toLowerCase();
    return hay.includes(q);
  }

  async function renderSearch() {
    const list = $("#searchList");
    if (!list) return;

    try {
      searchCache = await getAllEntries();
    } catch (err) {
      console.error(err);
      list.textContent = "Could not load entries.";
      return;
    }

    // newest first as default presentation
    searchCache.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));

    const qEl = $("#q");
    const q = (qEl?.value || "").trim().toLowerCase();
    const filtered = searchCache.filter((e) => matchesQuery(e, q));

    list.innerHTML = "";
    if (!filtered.length) {
      const empty = document.createElement("div");
      empty.className = "item";
      empty.innerHTML = `<div class="item__title">No matches.</div><div class="item__sub">Try a different keyword (Item, Location, Notes).</div>`;
      list.appendChild(empty);
      return;
    }

    for (const e of filtered) list.appendChild(makeEntryCard(e));
  }

  function wireSearch() {
    const q = $("#q");
    if (!q) return;
    q.addEventListener("input", () => renderSearch());
  }

  // ---------------------------
  // EDIT MODAL
  // ---------------------------
  const modal = $("#editModal");

  function setEditStatus(msg) {
    $("#editStatus").textContent = msg || "";
  }

  function closeModal() {
    setEditStatus("");
    $("#editForm")?.reset();
    if (modal?.open) modal.close();
  }

  async function openEdit(id) {
    const e = await getEntry(id);
    if (!e) {
      toast.show("Not found");
      return;
    }

    $("#eId").value = e.id;
    $("#eItem").value = e.item || "";
    $("#eLocation").value = e.location || "";
    $("#eInventory").value = e.inventory || "";
    $("#eDate").value = e.date || "";
    $("#eNotes").value = e.notes || "";

    const created = e.created_at ? `Created: ${fmt(e.created_at)}` : "";
    const updated = e.updated_at ? `Updated: ${fmt(e.updated_at)}` : "";
    $("#editMeta").textContent = [created, updated].filter(Boolean).join(" • ");

    setEditStatus("");
    modal?.showModal();
    $("#eItem")?.focus();
  }

  async function saveEdit() {
    const id = $("#eId").value;
    const item = ($("#eItem").value || "").trim();
    if (!item) {
      setEditStatus("Item is required.");
      toast.show("Item required");
      $("#eItem")?.focus();
      return;
    }

    const existing = await getEntry(id);
    if (!existing) {
      setEditStatus("Could not load entry for update.");
      return;
    }

    const updated = {
      ...existing,
      item,
      location: ($("#eLocation").value || "").trim(),
      inventory: ($("#eInventory").value || "").trim(),
      date: ($("#eDate").value || "").trim(),
      notes: ($("#eNotes").value || "").trim(),
      updated_at: nowISO()
    };

    try {
      await putEntry(updated);
      toast.show("Updated");
      closeModal();
      // refresh relevant views
      await renderMaster();
      await renderSearch();
    } catch (err) {
      console.error(err);
      setEditStatus("Update failed. Try again.");
      toast.show("Update failed");
    }
  }

  async function confirmDelete() {
    const id = $("#eId").value;
    const item = ($("#eItem").value || "").trim();
    const ok = confirm(`Delete "${item || "this entry"}"?`);
    if (!ok) return;

    try {
      await deleteEntry(id);
      toast.show("Deleted");
      closeModal();
      await renderMaster();
      await renderSearch();
    } catch (err) {
      console.error(err);
      setEditStatus("Delete failed. Try again.");
      toast.show("Delete failed");
    }
  }

  function wireModal() {
    $("#btnCloseModal")?.addEventListener("click", closeModal);
    $("#btnCancel")?.addEventListener("click", closeModal);
    $("#btnSave")?.addEventListener("click", saveEdit);
    $("#btnDelete")?.addEventListener("click", confirmDelete);

    // close on backdrop tap (mobile convenience)
    modal?.addEventListener("click", (e) => {
      if (e.target === modal) closeModal();
    });
  }

  // ---------------------------
  // Export / Import
  // ---------------------------
  function downloadText(filename, text) {
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function wireExportImport() {
    $("#btnExport")?.addEventListener("click", async () => {
      try {
        const json = await exportJSON();
        const stamp = new Date().toISOString().slice(0, 10);
        downloadText(`log-it-yeet-it-${stamp}.json`, json);
        toast.show("Exported");
      } catch (err) {
        console.error(err);
        toast.show("Export failed");
      }
    });

    $("#importFile")?.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;

      try {
        const text = await file.text();
        const n = await importJSON(text);
        toast.show(`Imported ${n} item(s)`);
        // Reset file input so same file can be re-imported if needed
        e.target.value = "";
        await renderMaster();
        await renderSearch();
      } catch (err) {
        console.error(err);
        alert(`Import failed: ${err.message || err}`);
      }
    });

    $("#btnRefresh")?.addEventListener("click", async () => {
      await renderMaster();
      toast.show("Refreshed");
    });
  }

  // ---------------------------
  // PWA Service Worker
  // ---------------------------
  async function registerSW() {
    if (!("serviceWorker" in navigator)) return;
    try {
      await navigator.serviceWorker.register("sw.js");
    } catch (err) {
      console.warn("SW registration failed:", err);
    }
  }

  // ---------------------------
  // Boot
  // ---------------------------
  async function boot() {
    wireTabs();
    wireLogForm();
    wireSearch();
    wireModal();
    wireExportImport();

    // Default state: Log tab, blank, notes collapsed.
    resetLogForm();
    setActiveTab("log");

    await registerSW();
  }

  boot();
})();
