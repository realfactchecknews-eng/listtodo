// DOM refs
const taskInput = document.getElementById('taskInput');
const addBtn = document.getElementById('addBtn');
const taskList = document.getElementById('taskList');
const emptyState = document.getElementById('emptyState');
const totalCount = document.getElementById('totalCount');
const activeCount = document.getElementById('activeCount');
const doneCount = document.getElementById('doneCount');
const filterBtns = document.querySelectorAll('.filter');
const dbUrlInput = document.getElementById('dbUrl');
const connectDbBtn = document.getElementById('connectDbBtn');
const syncCard = document.getElementById('syncCard');
const syncToggle = document.getElementById('syncToggle');
const syncStatus = document.getElementById('syncStatus');

// Constants
const STORAGE_KEY = 'project-ideas-tasks';
const DB_URL_KEY = 'project-ideas-db-url';
const SYNC_INTERVAL = 5000; // 5 seconds

// State
let tasks = [];
let currentFilter = 'all';
let dbUrl = loadDbUrl();
let isSyncingFromCloud = false;
let lastSavedTasksJson = '';
let syncIntervalId = null;
let cloudSaveTimeout = null;

// Init
init();

// Events
addBtn.addEventListener('click', addTask);
taskInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addTask();
});

filterBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    filterBtns.forEach((b) => b.classList.remove('is-active'));
    btn.classList.add('is-active');
    currentFilter = btn.dataset.filter;
    render();
  });
});

syncToggle.addEventListener('click', () => {
  syncCard.classList.toggle('is-open');
});

connectDbBtn.addEventListener('click', connectDatabase);
dbUrlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') connectDatabase();
});

// Sync UI init
dbUrlInput.value = dbUrl || '';
updateSyncStatus();
if (dbUrl) {
  syncCard.classList.add('is-open');
}

// Functions
async function init() {
  tasks = loadTasks();
  render();

  if (dbUrl) {
    try {
      await fetchTasksFromCloud();
      startPolling();
      updateSyncStatus('online');
    } catch (e) {
      console.error('Failed to sync on init', e);
      updateSyncStatus('offline');
    }
  }
}

function loadTasks() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch (e) {
    console.error('Failed to load tasks', e);
  }
  return [];
}

function saveTasks() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
  } catch (e) {
    console.error('Failed to save tasks locally', e);
  }
}

function loadDbUrl() {
  try {
    return localStorage.getItem(DB_URL_KEY) || '';
  } catch (e) {
    return '';
  }
}

function saveDbUrl(url) {
  try {
    if (url) {
      localStorage.setItem(DB_URL_KEY, url);
    } else {
      localStorage.removeItem(DB_URL_KEY);
    }
  } catch (e) {
    console.error('Failed to save DB URL', e);
  }
}

function normalizeDbUrl(url) {
  url = url.trim();
  if (url.endsWith('/')) url = url.slice(0, -1);
  if (url.endsWith('/tasks')) url = url.slice(0, -6);
  if (url.endsWith('/tasks.json')) url = url.slice(0, -11);
  return url;
}

function isCloudEnabled() {
  return !!dbUrl;
}

function updateSyncStatus(status) {
  if (!dbUrl) {
    syncStatus.textContent = 'Только на этом устройстве';
    syncStatus.classList.remove('is-online');
    return;
  }

  if (status === 'online') {
    syncStatus.textContent = 'Синхронизация работает';
    syncStatus.classList.add('is-online');
  } else if (status === 'offline') {
    syncStatus.textContent = 'Нет связи с базой';
    syncStatus.classList.remove('is-online');
  } else {
    syncStatus.textContent = 'Подключение...';
    syncStatus.classList.remove('is-online');
  }
}

async function connectDatabase() {
  let url = dbUrlInput.value.trim();
  if (!url) {
    // Disconnect
    dbUrl = '';
    saveDbUrl('');
    stopPolling();
    updateSyncStatus();
    syncCard.classList.remove('is-open');
    return;
  }

  url = normalizeDbUrl(url);
  dbUrl = url;
  saveDbUrl(url);
  updateSyncStatus('loading');

  try {
    await fetchTasksFromCloud();
    startPolling();
    updateSyncStatus('online');
  } catch (e) {
    console.error('Failed to connect database', e);
    updateSyncStatus('offline');
    alert('Не удалось подключиться. Проверь URL и правила доступа в Firebase.');
  }
}

async function fetchTasksFromCloud() {
  if (!dbUrl) return;
  const res = await fetch(`${dbUrl}/tasks.json`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const data = await res.json();
  isSyncingFromCloud = true;

  if (data === null || data === undefined) {
    tasks = [];
  } else if (Array.isArray(data)) {
    tasks = data;
  } else {
    tasks = Object.values(data);
  }

  saveTasks();
  render();
  isSyncingFromCloud = false;
  lastSavedTasksJson = JSON.stringify(tasks);
}

async function saveTasksToCloud() {
  if (!dbUrl || isSyncingFromCloud) return;

  const currentJson = JSON.stringify(tasks);
  if (currentJson === lastSavedTasksJson) return;

  try {
    const res = await fetch(`${dbUrl}/tasks.json`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: currentJson,
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    lastSavedTasksJson = currentJson;
    updateSyncStatus('online');
  } catch (e) {
    console.error('Cloud save failed', e);
    updateSyncStatus('offline');
  }
}

function scheduleCloudSave() {
  if (!dbUrl || isSyncingFromCloud) return;

  clearTimeout(cloudSaveTimeout);
  cloudSaveTimeout = setTimeout(() => {
    saveTasksToCloud();
  }, 400);
}

function startPolling() {
  stopPolling();
  if (!dbUrl) return;

  // Sync immediately and then on interval
  fetchTasksFromCloud().catch((e) => {
    console.error('Polling fetch failed', e);
    updateSyncStatus('offline');
  });

  syncIntervalId = setInterval(() => {
    fetchTasksFromCloud().catch((e) => {
      console.error('Polling fetch failed', e);
      updateSyncStatus('offline');
    });
  }, SYNC_INTERVAL);
}

function stopPolling() {
  if (syncIntervalId) {
    clearInterval(syncIntervalId);
    syncIntervalId = null;
  }
}

function addTask() {
  const text = taskInput.value.trim();
  if (!text) return;

  const task = {
    id: Date.now().toString(),
    text,
    completed: false,
    createdAt: Date.now(),
  };

  tasks.unshift(task);
  saveTasks();
  scheduleCloudSave();
  taskInput.value = '';
  taskInput.focus();
  render();
}

function toggleTask(id) {
  const task = tasks.find((t) => t.id === id);
  if (task) {
    task.completed = !task.completed;
    saveTasks();
    scheduleCloudSave();
    render();
  }
}

function deleteTask(id) {
  const el = document.querySelector(`[data-id="${id}"]`);
  if (el) {
    el.classList.add('is-exiting');
    el.addEventListener('animationend', () => {
      tasks = tasks.filter((t) => t.id !== id);
      saveTasks();
      scheduleCloudSave();
      render();
    }, { once: true });
  } else {
    tasks = tasks.filter((t) => t.id !== id);
    saveTasks();
    scheduleCloudSave();
    render();
  }
}

function getFilteredTasks() {
  if (currentFilter === 'active') return tasks.filter((t) => !t.completed);
  if (currentFilter === 'completed') return tasks.filter((t) => t.completed);
  return tasks;
}

function updateStats() {
  totalCount.textContent = tasks.length;
  activeCount.textContent = tasks.filter((t) => !t.completed).length;
  doneCount.textContent = tasks.filter((t) => t.completed).length;
}

function render() {
  const filtered = getFilteredTasks();
  taskList.innerHTML = '';

  if (filtered.length === 0) {
    emptyState.classList.add('is-visible');
  } else {
    emptyState.classList.remove('is-visible');
  }

  filtered.forEach((task) => {
    const li = document.createElement('li');
    li.className = `task-item ${task.completed ? 'is-completed' : ''}`;
    li.dataset.id = task.id;
    li.setAttribute('aria-label', task.text);

    li.innerHTML = `
      <div class="checkbox" role="button" aria-label="Отметить выполненным">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
      </div>
      <span class="task-text">${escapeHtml(task.text)}</span>
      <button class="btn btn--danger" aria-label="Удалить">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6"></polyline>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
        </svg>
      </button>
    `;

    li.querySelector('.checkbox').addEventListener('click', (e) => {
      e.stopPropagation();
      toggleTask(task.id);
    });

    li.querySelector('.task-text').addEventListener('click', () => {
      toggleTask(task.id);
    });

    li.querySelector('.btn--danger').addEventListener('click', (e) => {
      e.stopPropagation();
      deleteTask(task.id);
    });

    taskList.appendChild(li);
  });

  updateStats();
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
