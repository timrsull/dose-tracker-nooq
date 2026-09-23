// Dose Tracker - UI
import { init, Views, Actions, calculateNextDose, formatTimeUntil, formatDateTime, extractMedicationFromImage, isMobileDevice, getDebugLog, clearDebugLog } from './logic.js';

const APP_VERSION = '21';

let currentProvider = 'gemini'; // Will be loaded from settings

let medications = [];
let searchQuery = '';
let currentModal = null;
let showAddForm = false;
let isProcessingImage = false;
let pendingImages = []; // Queue of { base64, mimeType, name } for staged upload
let highlightedMedId = null; // ID of medication to highlight after adding

async function boot() {
  try {
    await init();
    currentProvider = await Views.getVisionProvider();
    await refreshMedications();
    showAddForm = medications.length === 0;
    render();
    startCountdownTimer();
  } catch (err) {
    document.getElementById('app').innerHTML = `<p class="error">Error: ${err.message}</p>`;
  }
}

async function refreshMedications() {
  if (searchQuery) {
    medications = await Views.searchMedications(searchQuery);
  } else {
    medications = await Views.listMedications();
  }
}

function startCountdownTimer() {
  setInterval(() => {
    updateCountdowns();
  }, 60000);
}

function updateCountdowns() {
  medications.forEach(med => {
    const el = document.querySelector(`[data-countdown-id="${med.id}"]`);
    if (el && med.dose_interval_hours && med.last_dose_at) {
      const nextDose = calculateNextDose(med.last_dose_at, med.dose_interval_hours);
      el.textContent = formatTimeUntil(nextDose);
      el.className = 'next-dose ' + (nextDose <= new Date() ? 'available' : 'waiting');
    }
  });
}

function render() {
  const app = document.getElementById('app');
  const shouldShowAddForm = showAddForm || medications.length === 0;
  const isMobile = isMobileDevice();

  app.innerHTML = `
    <header>
      <h1>Dose Tracker</h1>
      <button class="btn-settings" id="btn-settings" title="Settings">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
          <path fill-rule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clip-rule="evenodd"/>
        </svg>
      </button>
    </header>

    ${shouldShowAddForm ? `
      <section class="add-medication">
        <h2>Add Medication</h2>
        <form id="add-form">
          <div class="add-form-inputs">
            <input type="text" id="med-name" placeholder="Medication name" required>
            <input type="number" id="med-interval" placeholder="Hours between doses (optional)" min="0.5" step="0.5">
          </div>
          <div class="add-form-actions">
            ${isMobile ? `
              <label class="btn-camera" id="btn-camera-label">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M4 5a2 2 0 00-2 2v8a2 2 0 002 2h12a2 2 0 002-2V7a2 2 0 00-2-2h-1.586a1 1 0 01-.707-.293l-1.121-1.121A2 2 0 0011.172 3H8.828a2 2 0 00-1.414.586L6.293 4.707A1 1 0 015.586 5H4zm6 9a3 3 0 100-6 3 3 0 000 6z" clip-rule="evenodd"/>
                </svg>
                <span>Camera</span>
                <input type="file" id="camera-input" accept="image/*" capture="environment" hidden>
              </label>
              <label class="btn-camera btn-library" id="btn-library-label">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" clip-rule="evenodd"/>
                </svg>
                <span>Library</span>
                <input type="file" id="library-input" accept="image/*" multiple hidden>
              </label>
            ` : `
              <label class="btn-camera" id="btn-camera-label">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M4 5a2 2 0 00-2 2v8a2 2 0 002 2h12a2 2 0 002-2V7a2 2 0 00-2-2h-1.586a1 1 0 01-.707-.293l-1.121-1.121A2 2 0 0011.172 3H8.828a2 2 0 00-1.414.586L6.293 4.707A1 1 0 015.586 5H4zm6 9a3 3 0 100-6 3 3 0 000 6z" clip-rule="evenodd"/>
                </svg>
                <span>Images</span>
                <input type="file" id="camera-input" accept="image/*" multiple hidden>
              </label>
            `}
            <button type="submit">Add</button>
          </div>
        </form>
        ${pendingImages.length > 0 ? `
          <div class="pending-images">
            <div class="pending-images-header">
              <span>${pendingImages.length} image${pendingImages.length > 1 ? 's' : ''} ready</span>
              <button type="button" class="btn-clear-images" id="btn-clear-images">Clear</button>
            </div>
            <div class="pending-images-list">
              ${pendingImages.map((img, i) => `<div class="pending-image-thumb" title="${escapeHtml(img.name)}"></div>`).join('')}
              <label class="pending-image-add" id="btn-add-more">
                <span>+</span>
                <input type="file" id="camera-input-more" accept="image/*" multiple hidden>
              </label>
            </div>
            <div class="scan-options">
              <select id="scan-provider" class="scan-provider-select">
                <option value="gemini" ${currentProvider === 'gemini' ? 'selected' : ''}>Gemini</option>
                <option value="claude" ${currentProvider === 'claude' ? 'selected' : ''}>Claude</option>
              </select>
              <button type="button" class="btn-scan-all" id="btn-scan-all">Scan</button>
            </div>
          </div>
        ` : ''}
        <div id="scan-status" class="scan-status hidden"></div>
      </section>
    ` : ''}

    <section class="search-section">
      <input type="text" id="search-input" placeholder="Search medications..." value="${escapeHtml(searchQuery)}">
    </section>

    <section class="medications-list">
      <div class="medications-header">
        <h2>Your Medications</h2>
        ${!shouldShowAddForm ? `<button class="btn-add-compact" id="btn-show-add">+ Add</button>` : ''}
      </div>
      <div id="med-list-container">
        ${renderMedicationListContent()}
      </div>
    </section>

    <div id="modal-container"></div>
  `;

  attachEventListeners();
}

function renderMedicationListContent() {
  if (medications.length === 0) {
    return '<p class="empty-state">No medications yet. Add one above.</p>';
  }
  return `<ul id="med-list">${medications.map(renderMedication).join('')}</ul>`;
}

function updateMedicationListOnly() {
  const container = document.getElementById('med-list-container');
  if (container) {
    container.innerHTML = renderMedicationListContent();
    const medList = document.getElementById('med-list');
    if (medList) {
      medList.addEventListener('click', handleMedicationAction);
    }
  }
}

function renderMedication(med) {
  const nextDose = calculateNextDose(med.last_dose_at, med.dose_interval_hours);
  const nextDoseText = formatTimeUntil(nextDose);
  const isAvailable = nextDose ? nextDose <= new Date() : true;
  const isHighlighted = med.id === highlightedMedId;

  return `
    <li class="medication-item${isHighlighted ? ' highlight-new' : ''}" data-id="${med.id}">
      <div class="med-row">
        <div class="med-main">
          <div class="med-info">
            <span class="med-name">${escapeHtml(med.name)}</span>
            ${med.dose_interval_hours
              ? `<span class="med-interval">Every ${med.dose_interval_hours}h</span>`
              : ''
            }
          </div>
          <div class="med-status">
            <div class="last-dose">
              <span class="label">Last dose:</span>
              <span class="value clickable" data-action="history" data-id="${med.id}">${formatDateTime(med.last_dose_at)}</span>
            </div>
            ${med.dose_interval_hours ? `
              <div class="next-dose-container">
                <span class="label">Next available:</span>
                <span class="next-dose ${isAvailable ? 'available' : 'waiting'}" data-countdown-id="${med.id}">
                  ${nextDoseText || 'Take first dose'}
                </span>
              </div>
            ` : ''}
          </div>
          <div class="med-actions">
            <button class="btn-dose" data-action="dose" data-id="${med.id}">Record Dose</button>
            <button class="btn-history" data-action="history" data-id="${med.id}">History</button>
          </div>
        </div>
        <div class="med-secondary-actions">
          <button class="btn-icon" data-action="edit" data-id="${med.id}" title="Edit">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M12.146.854a.5.5 0 0 1 .708 0l2.292 2.292a.5.5 0 0 1 0 .708l-9.5 9.5a.5.5 0 0 1-.168.11l-4 1.5a.5.5 0 0 1-.65-.65l1.5-4a.5.5 0 0 1 .11-.168l9.5-9.5zM11.207 2L2 11.207V12h.793L13 2.793 11.207 2zM2.5 13.5l2.5-.938L3.438 11 2.5 13.5z"/>
            </svg>
          </button>
          <button class="btn-icon btn-icon-danger" data-action="delete" data-id="${med.id}" title="Delete">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/>
              <path fill-rule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4L4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/>
            </svg>
          </button>
        </div>
      </div>
    </li>
  `;
}

function attachEventListeners() {
  const addForm = document.getElementById('add-form');
  if (addForm) {
    addForm.addEventListener('submit', handleAddMedication);
  }

  const btnShowAdd = document.getElementById('btn-show-add');
  if (btnShowAdd) {
    btnShowAdd.addEventListener('click', () => {
      showAddForm = true;
      render();
      const nameInput = document.getElementById('med-name');
      if (nameInput) nameInput.focus();
    });
  }

  const btnSettings = document.getElementById('btn-settings');
  if (btnSettings) {
    btnSettings.addEventListener('click', showSettingsModal);
  }

  const cameraInput = document.getElementById('camera-input');
  if (cameraInput) {
    cameraInput.addEventListener('change', handleImageQueue);
  }

  const libraryInput = document.getElementById('library-input');
  if (libraryInput) {
    libraryInput.addEventListener('change', handleImageQueue);
  }

  const cameraInputMore = document.getElementById('camera-input-more');
  if (cameraInputMore) {
    cameraInputMore.addEventListener('change', handleImageQueue);
  }

  const btnClearImages = document.getElementById('btn-clear-images');
  if (btnClearImages) {
    btnClearImages.addEventListener('click', () => {
      pendingImages = [];
      render();
    });
  }

  const scanProvider = document.getElementById('scan-provider');
  if (scanProvider) {
    scanProvider.addEventListener('change', async (e) => {
      currentProvider = e.target.value;
      await Actions.saveVisionProvider(currentProvider);
    });
  }

  const btnScanAll = document.getElementById('btn-scan-all');
  if (btnScanAll) {
    btnScanAll.addEventListener('click', handleScanAllImages);
  }

  const searchInput = document.getElementById('search-input');
  let searchTimeout;
  searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    const newValue = e.target.value;
    searchTimeout = setTimeout(async () => {
      searchQuery = newValue;
      await refreshMedications();
      updateMedicationListOnly();
    }, 200);
  });

  const medList = document.getElementById('med-list');
  if (medList) {
    medList.addEventListener('click', handleMedicationAction);
  }
}

async function handleImageQueue(e) {
  const files = e.target.files;
  if (!files || files.length === 0) return;

  // Read all files as base64 and add to queue
  const newImages = await Promise.all(Array.from(files).map(file => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result;
        const base64Data = result.split(',')[1];
        resolve({ base64: base64Data, mimeType: file.type, name: file.name });
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }));

  pendingImages = [...pendingImages, ...newImages];
  e.target.value = ''; // Reset input
  render();
}

async function handleScanAllImages() {
  if (pendingImages.length === 0 || isProcessingImage) return;

  const statusEl = document.getElementById('scan-status');
  const scanBtn = document.getElementById('btn-scan-all');

  try {
    isProcessingImage = true;
    if (scanBtn) {
      scanBtn.disabled = true;
      scanBtn.textContent = 'Analyzing...';
    }
    if (statusEl) {
      statusEl.textContent = `Analyzing ${pendingImages.length} image${pendingImages.length > 1 ? 's' : ''}...`;
      statusEl.classList.remove('hidden', 'error');
    }

    const result = await extractMedicationFromImage(pendingImages);

    if (!result.name) {
      throw new Error('Could not identify medication name');
    }

    // Automatically add the medication
    const newMed = await Actions.createMedication(result.name, result.intervalHours);
    medications.push({
      id: newMed.id,
      name: newMed.name,
      dose_interval_hours: newMed.doseIntervalHours,
      created_at: new Date().toISOString(),
      last_dose_at: null
    });
    medications.sort((a, b) => a.name.localeCompare(b.name));

    // Clear pending images on success
    pendingImages = [];

    if (statusEl) {
      statusEl.textContent = `Added: ${result.name}`;
      setTimeout(() => statusEl.classList.add('hidden'), 3000);
    }

    // Hide add form, highlight the new medication, and show the list
    showAddForm = false;
    highlightedMedId = newMed.id;
    render();

    // Clear highlight after animation completes
    setTimeout(() => {
      highlightedMedId = null;
    }, 10000);

  } catch (err) {
    console.error('Image processing error:', err);
    if (statusEl) {
      statusEl.textContent = err.message;
      statusEl.classList.add('error');
    }
  } finally {
    isProcessingImage = false;
    if (scanBtn) {
      scanBtn.disabled = false;
      scanBtn.textContent = `Scan ${pendingImages.length} Image${pendingImages.length !== 1 ? 's' : ''}`;
    }
  }
}

async function handleAddMedication(e) {
  e.preventDefault();
  const nameInput = document.getElementById('med-name');
  const intervalInput = document.getElementById('med-interval');

  const name = nameInput.value.trim();
  const interval = intervalInput.value ? parseFloat(intervalInput.value) : null;

  if (!name) return;

  try {
    const newMed = await Actions.createMedication(name, interval);
    medications.push({
      ...newMed,
      created_at: new Date().toISOString(),
      last_dose_at: null
    });
    medications.sort((a, b) => a.name.localeCompare(b.name));
    nameInput.value = '';
    intervalInput.value = '';
    showAddForm = true;
    render();
  } catch (err) {
    alert('Error adding medication: ' + err.message);
  }
}

async function handleMedicationAction(e) {
  const target = e.target.closest('[data-action]');
  if (!target) return;

  const action = target.dataset.action;
  const id = parseInt(target.dataset.id, 10);
  const med = medications.find(m => m.id === id);

  if (!med) return;

  switch (action) {
    case 'dose':
      showRecordDoseModal(med);
      break;
    case 'history':
      await showDoseHistoryModal(med);
      break;
    case 'edit':
      showEditMedicationModal(med);
      break;
    case 'delete':
      await handleDeleteMedication(med);
      break;
  }
}

// ============ MODALS ============

function showModal(title, content, onClose) {
  const container = document.getElementById('modal-container');
  container.innerHTML = `
    <div class="modal-overlay">
      <div class="modal">
        <div class="modal-header">
          <h3>${escapeHtml(title)}</h3>
          <button class="modal-close" type="button">&times;</button>
        </div>
        <div class="modal-body">
          ${content}
        </div>
      </div>
    </div>
  `;

  const overlay = container.querySelector('.modal-overlay');
  const closeBtn = container.querySelector('.modal-close');

  const close = () => {
    container.innerHTML = '';
    currentModal = null;
    if (onClose) onClose();
  };

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  closeBtn.addEventListener('click', close);

  currentModal = { close };
  return container.querySelector('.modal-body');
}

function closeModal() {
  if (currentModal) currentModal.close();
}

function getLocalDateTimeString(date = new Date()) {
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60 * 1000);
  return local.toISOString().slice(0, 16);
}

async function showSettingsModal() {
  const content = `<div class="loading">Loading settings...</div>`;
  const body = showModal('Settings', content);

  try {
    const [geminiKey, claudeKey, provider] = await Promise.all([
      Views.getGeminiApiKey(),
      Views.getClaudeApiKey(),
      Views.getVisionProvider()
    ]);
    renderSettingsForm(body, { geminiKey, claudeKey, provider });
  } catch (err) {
    body.innerHTML = `<p class="error">Error loading settings: ${err.message}</p>`;
  }
}

function renderSettingsForm(body, settings) {
  const logs = getDebugLog();
  const { geminiKey, claudeKey, provider } = settings;

  body.innerHTML = `
    <div class="settings-version">Version ${APP_VERSION}</div>
    <form id="settings-form">
      <div class="form-group">
        <label for="vision-provider">Vision Provider</label>
        <select id="vision-provider">
          <option value="gemini" ${provider === 'gemini' ? 'selected' : ''}>Gemini (Google)</option>
          <option value="claude" ${provider === 'claude' ? 'selected' : ''}>Claude (Anthropic)</option>
        </select>
      </div>

      <div class="form-group" id="gemini-settings" ${provider === 'claude' ? 'style="display:none"' : ''}>
        <label for="gemini-api-key">Gemini API Key</label>
        <input type="password" id="gemini-api-key" value="${escapeHtml(geminiKey || '')}" placeholder="AIza...">
        <p class="field-hint">
          <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener">Get API key</a> - Free tier: 15 req/min
        </p>
      </div>

      <div class="form-group" id="claude-settings" ${provider === 'gemini' ? 'style="display:none"' : ''}>
        <label for="claude-api-key">Claude API Key</label>
        <input type="password" id="claude-api-key" value="${escapeHtml(claudeKey || '')}" placeholder="sk-ant-...">
        <p class="field-hint">
          <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">Get API key</a> - Requires paid account
        </p>
      </div>

      <div class="modal-actions">
        <button type="button" class="btn-cancel">Cancel</button>
        <button type="submit" class="btn-save">Save</button>
      </div>
    </form>

    <div class="debug-section">
      <div class="debug-header">
        <h4>API Debug Log</h4>
        ${logs.length > 0 ? '<button type="button" class="btn-clear-log">Clear</button>' : ''}
      </div>
      ${logs.length === 0
        ? '<p class="debug-empty">No API calls logged yet. Try scanning an image.</p>'
        : `<div class="debug-log">${logs.map(log => `
            <div class="debug-entry debug-${log.type}">
              <div class="debug-time">${new Date(log.timestamp).toLocaleTimeString()}</div>
              <div class="debug-content">
                <strong>${log.type.toUpperCase()}</strong>
                ${log.url ? `<br>URL: ${escapeHtml(log.url)}` : ''}
                ${log.imageCount ? `<br>Images: ${log.imageCount}` : ''}
                ${log.status ? `<br>Status: ${log.status} ${log.statusText || ''}` : ''}
                ${log.error ? `<br>Error: ${escapeHtml(log.error)}` : ''}
                ${log.result ? `<br>Result: ${escapeHtml(JSON.stringify(log.result))}` : ''}
                ${log.body ? `<details><summary>Body</summary><button type="button" class="btn-copy-body" data-body="${escapeHtml(JSON.stringify(log.body))}">Copy</button><pre>${escapeHtml(JSON.stringify(log.body, null, 2))}</pre></details>` : ''}
              </div>
            </div>
          `).join('')}</div>`
      }
    </div>
  `;

  body.querySelector('.btn-cancel').addEventListener('click', closeModal);

  // Toggle API key fields based on provider selection
  const providerSelect = body.querySelector('#vision-provider');
  const geminiSettings = body.querySelector('#gemini-settings');
  const claudeSettings = body.querySelector('#claude-settings');

  providerSelect.addEventListener('change', () => {
    if (providerSelect.value === 'claude') {
      geminiSettings.style.display = 'none';
      claudeSettings.style.display = '';
    } else {
      geminiSettings.style.display = '';
      claudeSettings.style.display = 'none';
    }
  });

  body.querySelector('#settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const newProvider = body.querySelector('#vision-provider').value;
    const newGeminiKey = body.querySelector('#gemini-api-key').value.trim();
    const newClaudeKey = body.querySelector('#claude-api-key').value.trim();

    try {
      await Promise.all([
        Actions.saveVisionProvider(newProvider),
        Actions.saveGeminiApiKey(newGeminiKey),
        Actions.saveClaudeApiKey(newClaudeKey)
      ]);
      closeModal();
    } catch (err) {
      alert('Error saving settings: ' + err.message);
    }
  });

  const clearBtn = body.querySelector('.btn-clear-log');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      clearDebugLog();
      renderSettingsForm(body, {
        geminiKey: body.querySelector('#gemini-api-key').value,
        claudeKey: body.querySelector('#claude-api-key').value,
        provider: body.querySelector('#vision-provider').value
      });
    });
  }

  body.querySelectorAll('.btn-copy-body').forEach(btn => {
    btn.addEventListener('click', async () => {
      const bodyData = btn.dataset.body;
      let success = false;

      // Try modern clipboard API first
      if (navigator.clipboard && navigator.clipboard.writeText) {
        try {
          await navigator.clipboard.writeText(bodyData);
          success = true;
        } catch (err) {
          // Fall through to fallback
        }
      }

      // Fallback: create temporary textarea
      if (!success) {
        const textarea = document.createElement('textarea');
        textarea.value = bodyData;
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        textarea.style.top = '0';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        try {
          success = document.execCommand('copy');
        } catch (err) {
          success = false;
        }
        document.body.removeChild(textarea);
      }

      btn.textContent = success ? 'Copied!' : 'Failed';
      setTimeout(() => btn.textContent = 'Copy', 1500);
    });
  });
}

function showRecordDoseModal(med, existingDose = null) {
  const isEdit = !!existingDose;
  const title = isEdit ? 'Edit Dose' : `Record Dose: ${med.name}`;
  const defaultTime = existingDose
    ? getLocalDateTimeString(new Date(existingDose.taken_at))
    : getLocalDateTimeString();

  const content = `
    <form id="dose-form">
      <div class="form-group">
        <label for="dose-time">Date & Time</label>
        <input type="datetime-local" id="dose-time" value="${defaultTime}" required>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn-cancel">Cancel</button>
        <button type="submit" class="btn-save">${isEdit ? 'Update' : 'Save'}</button>
      </div>
    </form>
  `;

  const body = showModal(title, content);

  body.querySelector('.btn-cancel').addEventListener('click', closeModal);
  body.querySelector('#dose-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const timeInput = body.querySelector('#dose-time');
    const takenAt = new Date(timeInput.value).toISOString();

    try {
      if (isEdit) {
        await Actions.updateDose(existingDose.id, takenAt);
      } else {
        await Actions.recordDose(med.id, takenAt);
      }
      await refreshMedications();
      closeModal();
      showAddForm = false;
      render();
    } catch (err) {
      alert('Error saving dose: ' + err.message);
    }
  });
}

async function showDoseHistoryModal(med) {
  const content = `<div class="loading">Loading...</div>`;
  const body = showModal(`Dose History: ${med.name}`, content);

  try {
    const doses = await Views.listDoses(med.id);
    renderDoseHistory(body, med, doses);
  } catch (err) {
    body.innerHTML = `<p class="error">Error loading history: ${err.message}</p>`;
  }
}

function renderDoseHistory(body, med, doses) {
  if (doses.length === 0) {
    body.innerHTML = `
      <p class="empty-state">No doses recorded yet.</p>
      <div class="modal-actions">
        <button type="button" class="btn-add-dose">Record First Dose</button>
      </div>
    `;
    body.querySelector('.btn-add-dose').addEventListener('click', () => {
      closeModal();
      showRecordDoseModal(med);
    });
    return;
  }

  body.innerHTML = `
    <ul class="dose-list">
      ${doses.map(dose => `
        <li class="dose-item" data-dose-id="${dose.id}">
          <span class="dose-time">${formatDateTime(dose.taken_at)}</span>
          <div class="dose-actions">
            <button class="btn-edit-dose" data-dose-id="${dose.id}">Edit</button>
            <button class="btn-delete-dose" data-dose-id="${dose.id}">Delete</button>
          </div>
        </li>
      `).join('')}
    </ul>
    <div class="modal-actions">
      <button type="button" class="btn-add-dose">Record New Dose</button>
    </div>
  `;

  body.querySelector('.btn-add-dose').addEventListener('click', () => {
    closeModal();
    showRecordDoseModal(med);
  });

  body.querySelectorAll('.btn-edit-dose').forEach(btn => {
    btn.addEventListener('click', () => {
      const doseId = parseInt(btn.dataset.doseId, 10);
      const dose = doses.find(d => d.id === doseId);
      if (dose) {
        closeModal();
        showRecordDoseModal(med, dose);
      }
    });
  });

  body.querySelectorAll('.btn-delete-dose').forEach(btn => {
    btn.addEventListener('click', async () => {
      const doseId = parseInt(btn.dataset.doseId, 10);
      if (!confirm('Delete this dose record?')) return;

      try {
        await Actions.deleteDose(doseId);
        doses = doses.filter(d => d.id !== doseId);
        await refreshMedications();
        renderDoseHistory(body, med, doses);
        updateMedicationListOnly();
      } catch (err) {
        alert('Error deleting dose: ' + err.message);
      }
    });
  });
}

function showEditMedicationModal(med) {
  const content = `
    <form id="edit-med-form">
      <div class="form-group">
        <label for="edit-med-name">Medication Name</label>
        <input type="text" id="edit-med-name" value="${escapeHtml(med.name)}" required>
      </div>
      <div class="form-group">
        <label for="edit-med-interval">Hours Between Doses (optional)</label>
        <input type="number" id="edit-med-interval" value="${med.dose_interval_hours || ''}" min="0.5" step="0.5" placeholder="Leave empty for no interval">
      </div>
      <div class="modal-actions">
        <button type="button" class="btn-cancel">Cancel</button>
        <button type="submit" class="btn-save">Save</button>
      </div>
    </form>
  `;

  const body = showModal('Edit Medication', content);

  body.querySelector('.btn-cancel').addEventListener('click', closeModal);
  body.querySelector('#edit-med-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const newName = body.querySelector('#edit-med-name').value.trim();
    const intervalVal = body.querySelector('#edit-med-interval').value;
    const newInterval = intervalVal ? parseFloat(intervalVal) : null;

    if (!newName) return;

    try {
      await Actions.updateMedication(med.id, newName, newInterval);
      const idx = medications.findIndex(m => m.id === med.id);
      if (idx !== -1) {
        medications[idx].name = newName;
        medications[idx].dose_interval_hours = newInterval;
      }
      medications.sort((a, b) => a.name.localeCompare(b.name));
      closeModal();
      showAddForm = false;
      render();
    } catch (err) {
      alert('Error updating medication: ' + err.message);
    }
  });
}

async function handleDeleteMedication(med) {
  if (!confirm(`Delete "${med.name}" and all its dose history?`)) return;

  try {
    await Actions.deleteMedication(med.id);
    medications = medications.filter(m => m.id !== med.id);
    if (medications.length === 0) {
      showAddForm = true;
    }
    render();
  } catch (err) {
    alert('Error deleting medication: ' + err.message);
  }
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

boot();
