// API Base URL
const API_URL = 'http://localhost:3000/api';

// State Management
let tickets = [];
let steps = [];
let usedTicketNumbers = new Set();
let customColors = [];
let selectedTickets = new Set();
let isDragging = false;
let draggedTicketId = null;
let isSelectionMode = false;
let bulkDragGhost = null;
let undoHistory = [];
let originalSteps = [];
let hasUnsavedChanges = false;
let changeLog = [];
let currentColorPickerTicketId = null;
let isUpdatingColorInputs = false;
let notesSaveTimers = new Map();

// Default color palette (used for new tickets and UI)
const DEFAULT_COLORS = ['pink', 'orange', 'yellow', 'blue'];

function pickNextDefaultColor(lastColor) {
    const idx = DEFAULT_COLORS.indexOf(lastColor);
    if (idx === -1) return DEFAULT_COLORS[0];
    return DEFAULT_COLORS[(idx + 1) % DEFAULT_COLORS.length];
}

// Global quick color picker state for fluid open/close
let activeQuickPicker = null;
let activePaletteWrap = null;
let pickerCollapseTimer = null;
let pickerTrackingInstalled = false;

function collapseActivePicker(immediate = false) {
    if (!activeQuickPicker) return;
    if (pickerCollapseTimer) clearTimeout(pickerCollapseTimer);

    const picker = activeQuickPicker;
    const wrap = activePaletteWrap;
    const rowEl = picker.closest('.ticket-row');

    const doCollapse = () => {
        picker.classList.remove('expanded');
        if (wrap) wrap.style.maxWidth = '0px';
        if (rowEl) rowEl.classList.remove('no-drag');
    };

    if (immediate) doCollapse();
    else pickerCollapseTimer = setTimeout(doCollapse, 180);
}

function ensurePickerPointerTracking() {
    if (pickerTrackingInstalled) return;
    pickerTrackingInstalled = true;
    document.addEventListener('mousemove', (e) => {
        if (!activeQuickPicker) return;
        const rect = activeQuickPicker.getBoundingClientRect();
        const margin = 12; // small cushion so it doesn't collapse at the exact edge
        const inside = (
            e.clientX >= rect.left - margin && e.clientX <= rect.right + margin &&
            e.clientY >= rect.top - margin && e.clientY <= rect.bottom + margin
        );
        if (!inside) collapseActivePicker(true);
    });
}


// Load custom colors from localStorage
function loadCustomColors() {
    const saved = localStorage.getItem('customColors');
    if (saved) {
        customColors = JSON.parse(saved);
    }
}

// Save custom colors to localStorage
function saveCustomColors() {
    localStorage.setItem('customColors', JSON.stringify(customColors));
}

loadCustomColors();

// Custom confirmation modal
function showConfirm(title, message, onConfirm) {
    const modal = new bootstrap.Modal(document.getElementById('confirmModal'));
    const titleEl = document.getElementById('confirmModalTitle');
    const messageEl = document.getElementById('confirmModalMessage');
    const confirmBtn = document.getElementById('confirmModalConfirm');
    
    titleEl.textContent = title;
    messageEl.textContent = message;
    
    // Remove old listeners and add new one
    const newConfirmBtn = confirmBtn.cloneNode(true);
    confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
    
    newConfirmBtn.addEventListener('click', () => {
        modal.hide();
        onConfirm();
    });
    
    modal.show();
}

// Initialize the application
document.addEventListener('DOMContentLoaded', async () => {
    loadAppSettings();
    await loadSteps();
    await loadTickets();
    setupEventListeners();
});

// Setup Event Listeners
function setupEventListeners() {
    document.getElementById('addTicketBtn').addEventListener('click', addTicket);
    document.getElementById('addStepBtn').addEventListener('click', addStep);
    document.getElementById('saveStepsBtn').addEventListener('click', saveAllSteps);
    document.getElementById('exportSettingsBtn').addEventListener('click', exportSettings);
    
    // Hover to open export menu: already handled by CSS, but ensure click closes
    document.querySelectorAll('.export-menu-toggle').forEach(t => {
        t.addEventListener('click', (e) => e.preventDefault());
    });

    // Export menu options
    document.querySelectorAll('.export-option').forEach(btn => {
        btn.addEventListener('click', () => {
            const type = btn.dataset.exportType; // 'configuration' or 'notes'
            const format = btn.dataset.exportFormat; // 'json','toml','csv','pdf','docx'
            openExportPreview(type, format);
        });
    });

    // Simple import: auto-detect file type on selection
    const importBtn = document.getElementById('importSettingsBtn');
    if (importBtn) {
        importBtn.addEventListener('click', () => {
            const input = document.getElementById('importFileInput');
            input.value = '';
            input.click();
        });
    }
    document.getElementById('importFileInput').addEventListener('change', importSettings);
    // Undo button removed from UI
    document.getElementById('settingsModalClose').addEventListener('click', handleSettingsClose);
    document.getElementById('saveCustomColorBtn').addEventListener('click', saveColorFromModal);
    
    // Setup color picker modal input listeners
    setupColorPickerModalListeners();
    
    // Setup visual picker box click
    document.getElementById('visualPickerBox').addEventListener('click', () => {
        document.getElementById('modalColorPicker').click();
    });

    // Click-to-delete on red delete semicircle (treat same as dropping)
    const deleteZone = document.getElementById('dragDeleteZone');
    const deleteInner = document.querySelector('#dragDeleteZone .drag-delete-inner');

    async function handleDeleteZoneClick(e) {
        e.stopPropagation();
        // If currently dragging multiple selections
        if (isSelectionMode && selectedTickets.size > 1) {
            const count = selectedTickets.size;
            showConfirm(
                `Delete ${count} Tickets?`,
                'This action cannot be undone.',
                async () => {
                    const ticketIds = Array.from(selectedTickets);
                    for (const id of ticketIds) {
                        await deleteTicket(id);
                    }
                    selectedTickets.clear();
                    exitSelectionMode();
                    endDragMode();
                    draggedTicketId = null;
                }
            );
            return;
        }
        // Single selected in selection mode
        if (isSelectionMode && selectedTickets.size === 1) {
            const ticketId = Array.from(selectedTickets)[0];
            await deleteTicket(ticketId);
            exitSelectionMode();
            endDragMode();
            draggedTicketId = null;
            return;
        }
        // If dragging a single ticket (not in selection mode)
        if (isDragging && draggedTicketId) {
            const ticketToDelete = draggedTicketId;
            await deleteTicket(ticketToDelete);
            endDragMode();
            draggedTicketId = null;
            return;
        }
        // Nothing selected: no-op
    }

    if (deleteZone) deleteZone.addEventListener('click', handleDeleteZoneClick);
    if (deleteInner) deleteInner.addEventListener('click', handleDeleteZoneClick);

    // Cancel button inside settings footer
    const settingsCancelBtn = document.getElementById('settingsCancelBtn');
    if (settingsCancelBtn) settingsCancelBtn.addEventListener('click', handleSettingsClose);
    
    // Setup settings modal open event to capture original state
    const settingsModal = document.getElementById('settingsModal');
    settingsModal.addEventListener('show.bs.modal', () => {
        originalSteps = JSON.parse(JSON.stringify(steps));
        hasUnsavedChanges = false;
        undoHistory = [];
        changeLog = [];
        updateUndoButton();
        updateSaveButtonState();
        // sync toggles
        loadAppSettings();
    });
    // Toggle handlers
    const chkCustom = document.getElementById('toggleCustomNumbering');
    const chkSeq = document.getElementById('toggleSequentialNumbers');
    if (chkCustom) chkCustom.addEventListener('change', () => { 
        appSettings.customNumbering = chkCustom.checked; 
        hasUnsavedChanges = true;
        updateSaveButtonState();
    });
    if (chkSeq) chkSeq.addEventListener('change', () => { 
        appSettings.randomTwoDigitNumbers = chkSeq.checked; 
        hasUnsavedChanges = true;
        updateSaveButtonState();
    });
}

// Settings (persisted)
let appSettings = { customNumbering: false, randomTwoDigitNumbers: false };
function loadAppSettings() {
    try {
        const raw = localStorage.getItem('tmSettings');
        if (raw) {
            const parsed = JSON.parse(raw);
            // Migrate legacy sequentialNumbers -> randomTwoDigitNumbers (invert semantics)
            if (typeof parsed.sequentialNumbers === 'boolean' && typeof parsed.randomTwoDigitNumbers !== 'boolean') {
                parsed.randomTwoDigitNumbers = !parsed.sequentialNumbers;
                delete parsed.sequentialNumbers;
                // Persist migration so subsequent loads use the new key
                appSettings = Object.assign(appSettings, parsed);
                saveAppSettings();
            } else {
                appSettings = Object.assign(appSettings, parsed);
            }
        }
    } catch {}
    // sync UI if present
    const chkCustom = document.getElementById('toggleCustomNumbering');
    const chkSeq = document.getElementById('toggleSequentialNumbers');
    if (chkCustom) chkCustom.checked = !!appSettings.customNumbering;
    if (chkSeq) chkSeq.checked = !!appSettings.randomTwoDigitNumbers;
}
function saveAppSettings() {
    localStorage.setItem('tmSettings', JSON.stringify(appSettings));
}

// Generate ticket number based on settings
function generateNewTicketNumber() {
    if (appSettings.randomTwoDigitNumbers) {
        // Random two-digit unique (10-99)
        let number;
        let guard = 0;
        do {
            number = Math.floor(Math.random() * 90) + 10;
            guard++;
            if (guard > 500) break; // fail-safe
        } while (usedTicketNumbers.has(number));
        usedTicketNumbers.add(number);
        return number;
    } else {
        // Sequential: next integer after current max
        let max = 0;
        usedTicketNumbers.forEach(n => { if (typeof n === 'number' && n > max) max = n; });
        const next = max + 1 || 1;
        usedTicketNumbers.add(next);
        return next;
    }
}

// Load all tickets from database
async function loadTickets() {
    try {
        const response = await fetch(`${API_URL}/tickets`);
        tickets = await response.json();
        
        // Track used ticket numbers
        tickets.forEach(ticket => {
            usedTicketNumbers.add(ticket.ticket_number);
        });
        
        renderTickets();
    } catch (error) {
        console.error('Error loading tickets:', error);
        showError('Failed to load tickets. Make sure the server is running.');
    }
}

// Load all steps from database
async function loadSteps() {
    try {
        const response = await fetch(`${API_URL}/steps`);
        steps = await response.json();
        renderSteps();
    } catch (error) {
        console.error('Error loading steps:', error);
        showError('Failed to load steps. Make sure the server is running.');
    }
}

// Add a new ticket
async function addTicket() {
    try {
        // Choose a default color that is different from the last ticket's color
        const last = tickets[tickets.length - 1] || null;
        const lastColor = last ? last.color : null;
        const baseLast = (typeof lastColor === 'string' && lastColor.startsWith('#')) ? null : lastColor; // ignore custom hex
        const nextColor = pickNextDefaultColor(baseLast);

        const ticketData = {
            ticket_number: generateNewTicketNumber(),
            color: nextColor,
            notes: '',
            current_step_id: steps.length > 0 ? steps[0].id : null,
            order_index: tickets.length // append to end
        };
        
        const response = await fetch(`${API_URL}/tickets`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(ticketData)
        });
        
        const newTicket = await response.json();
        tickets.push(newTicket);
        
        renderTickets();
    } catch (error) {
        console.error('Error adding ticket:', error);
        showError('Failed to add ticket.');
    }
}

// Update ticket in database
async function updateTicket(ticketId, updates) {
    try {
        await fetch(`${API_URL}/tickets/${ticketId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updates)
        });
        
        // Update local state
        const ticket = tickets.find(t => t.id === ticketId);
        if (ticket) {
            Object.assign(ticket, updates);
        }
    } catch (error) {
        console.error('Error updating ticket:', error);
        showError('Failed to update ticket.');
    }
}

// Debounced notes updater: keeps notes in local state immediately and persists after a short delay
function updateTicketNotes(ticketId, text) {
    // Update local state immediately so re-renders preserve the text
    const t = tickets.find(t => t.id === ticketId);
    if (t) t.notes = text;

    // Debounce server persistence per ticket
    if (notesSaveTimers.has(ticketId)) {
        clearTimeout(notesSaveTimers.get(ticketId));
    }
    const timer = setTimeout(() => {
        updateTicket(ticketId, { notes: text });
        notesSaveTimers.delete(ticketId);
    }, 400);
    notesSaveTimers.set(ticketId, timer);
}

// Delete ticket
async function deleteTicket(ticketId) {
    try {
        await fetch(`${API_URL}/tickets/${ticketId}`, {
            method: 'DELETE'
        });
        
        tickets = tickets.filter(t => t.id !== ticketId);
        renderTickets();
    } catch (error) {
        console.error('Error deleting ticket:', error);
        showError('Failed to delete ticket.');
    }
}

// Change ticket step (navigate left/right)
function changeTicketStep(ticketId, direction) {
    const ticket = tickets.find(t => t.id === ticketId);
    if (!ticket || steps.length === 0) return;
    
    let currentIndex = steps.findIndex(s => s.id === ticket.current_step_id);
    
    // If ticket has no step, start from beginning (0) or end (length-1) depending on direction
    if (currentIndex === -1) {
        currentIndex = direction === 'right' ? -1 : steps.length;
    }
    
    let newIndex;
    
    if (direction === 'left') {
        newIndex = currentIndex > 0 ? currentIndex - 1 : 0;
    } else {
        newIndex = currentIndex < steps.length - 1 ? currentIndex + 1 : steps.length - 1;
    }
    
    const newStepId = steps[newIndex]?.id || null;
    const newStep = steps[newIndex];
    
    // Update ticket state
    ticket.current_step_id = newStepId;
    updateTicket(ticketId, { current_step_id: newStepId });
    
    // Update UI immediately without full re-render
    const row = document.getElementById(`ticket-${ticketId}`);
    if (row) {
        const stepNameEl = row.querySelector('.step-name');
        const leftArrow = row.querySelector('.step-arrow-left');
        const rightArrow = row.querySelector('.step-arrow-right');
        
        if (stepNameEl) {
            stepNameEl.textContent = newStep ? newStep.name : 'No step';
        }
        
        // Update arrow states
        if (leftArrow) {
            leftArrow.disabled = newIndex === 0;
        }
        if (rightArrow) {
            rightArrow.disabled = newIndex === steps.length - 1;
        }
    }
}

// Calculate relative luminance for a color (WCAG formula)
function getRelativeLuminance(r, g, b) {
    const rsRGB = r / 255;
    const gsRGB = g / 255;
    const bsRGB = b / 255;
    
    const rLin = rsRGB <= 0.03928 ? rsRGB / 12.92 : Math.pow((rsRGB + 0.055) / 1.055, 2.4);
    const gLin = gsRGB <= 0.03928 ? gsRGB / 12.92 : Math.pow((gsRGB + 0.055) / 1.055, 2.4);
    const bLin = bsRGB <= 0.03928 ? bsRGB / 12.92 : Math.pow((bsRGB + 0.055) / 1.055, 2.4);
    
    return 0.2126 * rLin + 0.7152 * gLin + 0.0722 * bLin;
}

// Convert hex color to RGB
function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : null;
}

// Determine if text should be white or dark based on background color
function shouldUseWhiteText(color) {
    let rgb;
    
    // If it's a hex color, convert it
    if (color.startsWith('#')) {
        rgb = hexToRgb(color);
    } else {
        // Get RGB from preset color
        const colorValue = getColorValue(color);
        rgb = hexToRgb(colorValue);
    }
    
    if (!rgb) return false;
    
    // Calculate luminance
    const luminance = getRelativeLuminance(rgb.r, rgb.g, rgb.b);
    
    // Use white text if luminance is less than 0.5 (dark background)
    return luminance < 0.5;
}

// Apply text color based on background
function applyTextColorForBackground(row, color) {
    const useWhiteText = shouldUseWhiteText(color);
    
    // Apply to step navigator elements
    const stepName = row.querySelector('.step-name');
    const leftArrow = row.querySelector('.step-arrow-left');
    const rightArrow = row.querySelector('.step-arrow-right');
    const ticketNumber = row.querySelector('.ticket-number');
    
    if (useWhiteText) {
        row.classList.add('dark-background');
        if (stepName) stepName.style.color = 'white';
        if (ticketNumber) ticketNumber.style.color = 'white';
        
        [leftArrow, rightArrow].forEach(arrow => {
            if (arrow) {
                arrow.style.borderColor = 'white';
                arrow.style.color = 'white';
            }
        });
    } else {
        row.classList.remove('dark-background');
        if (stepName) stepName.style.color = '';
        if (ticketNumber) ticketNumber.style.color = '';
        
        [leftArrow, rightArrow].forEach(arrow => {
            if (arrow) {
                arrow.style.borderColor = '';
                arrow.style.color = '';
            }
        });
    }
}

// Apply a color visually to a ticket row without persisting
function setTicketRowColorUI(row, color) {
    if (!row) return;
    // Remove all color classes
    row.classList.remove('bg-yellow', 'bg-pink', 'bg-blue', 'bg-green', 'bg-purple', 'bg-orange', 'bg-white');
    // Apply color
    if (color.startsWith('#')) {
        row.style.backgroundColor = color;
    } else {
        row.classList.add(`bg-${color}`);
        row.style.backgroundColor = '';
    }
    // Adjust text contrast
    applyTextColorForBackground(row, color);
}

// Change ticket color (persist to DB and update UI)
function changeTicketColor(ticketId, color) {
    const ticket = tickets.find(t => t.id === ticketId);
    if (!ticket) return;
    ticket.color = color;
    updateTicket(ticketId, { color });

    const row = document.getElementById(`ticket-${ticketId}`);
    if (row) {
        setTicketRowColorUI(row, color);
        // Update selected state in color option palettes (if present)
        row.querySelectorAll('.color-option').forEach(opt => {
            opt.classList.toggle('selected', opt.dataset.color === color);
        });
    }
}

// Open color picker modal
function openColorPickerModal(ticketId) {
    currentColorPickerTicketId = ticketId;
    const modal = new bootstrap.Modal(document.getElementById('colorPickerModal'));
    
    // Reset to initial state - clear all inputs and remove has-color class
    const visualBox = document.getElementById('visualPickerBox');
    visualBox.classList.remove('has-color');
    visualBox.style.backgroundColor = '';
    visualBox.style.borderColor = '';
    
    document.getElementById('modalColorPicker').value = '#ffffff';
    document.getElementById('hexInput').value = '';
    document.getElementById('rgbR').value = '';
    document.getElementById('rgbG').value = '';
    document.getElementById('rgbB').value = '';
    document.getElementById('cmykC').value = '';
    document.getElementById('cmykM').value = '';
    document.getElementById('cmykY').value = '';
    document.getElementById('cmykK').value = '';
    
    modal.show();
}

// Setup color picker modal listeners
function setupColorPickerModalListeners() {
    const modalColorPicker = document.getElementById('modalColorPicker');
    const hexInput = document.getElementById('hexInput');
    const rgbR = document.getElementById('rgbR');
    const rgbG = document.getElementById('rgbG');
    const rgbB = document.getElementById('rgbB');
    const cmykC = document.getElementById('cmykC');
    const cmykM = document.getElementById('cmykM');
    const cmykY = document.getElementById('cmykY');
    const cmykK = document.getElementById('cmykK');
    
    // Visual color picker change
    modalColorPicker.addEventListener('input', (e) => {
        if (!isUpdatingColorInputs) {
            updateColorPickerFromHex(e.target.value);
        }
    });
    
    // Hex input change
    hexInput.addEventListener('input', (e) => {
        if (!isUpdatingColorInputs) {
            const hex = e.target.value;
            if (/^#[0-9A-Fa-f]{6}$/.test(hex)) {
                updateColorPickerFromHex(hex);
            }
        }
    });
    
    // RGB inputs change
    [rgbR, rgbG, rgbB].forEach(input => {
        input.addEventListener('input', () => {
            if (!isUpdatingColorInputs) {
                const r = parseInt(rgbR.value) || 0;
                const g = parseInt(rgbG.value) || 0;
                const b = parseInt(rgbB.value) || 0;
                const hex = rgbToHex(r, g, b);
                updateColorPickerFromHex(hex);
            }
        });
    });
    
    // CMYK inputs change
    [cmykC, cmykM, cmykY, cmykK].forEach(input => {
        input.addEventListener('input', () => {
            if (!isUpdatingColorInputs) {
                const c = parseInt(cmykC.value) || 0;
                const m = parseInt(cmykM.value) || 0;
                const y = parseInt(cmykY.value) || 0;
                const k = parseInt(cmykK.value) || 0;
                const rgb = cmykToRgb(c, m, y, k);
                const hex = rgbToHex(rgb.r, rgb.g, rgb.b);
                updateColorPickerFromHex(hex);
            }
        });
    });
}

// Update all color inputs from hex value
function updateColorPickerFromHex(hex) {
    isUpdatingColorInputs = true;
    
    // Update visual picker box - background shows the selected color
    const visualBox = document.getElementById('visualPickerBox');
    if (visualBox) {
        visualBox.style.backgroundColor = hex;
        visualBox.style.borderColor = hex;
        visualBox.classList.add('has-color');
    }
    
    // Update hidden color input
    document.getElementById('modalColorPicker').value = hex;
    
    // Update hex input
    document.getElementById('hexInput').value = hex.toUpperCase();
    
    // Convert to RGB
    const rgb = hexToRgb(hex);
    if (rgb) {
        document.getElementById('rgbR').value = rgb.r;
        document.getElementById('rgbG').value = rgb.g;
        document.getElementById('rgbB').value = rgb.b;
        
        // Convert to CMYK
        const cmyk = rgbToCmyk(rgb.r, rgb.g, rgb.b);
        document.getElementById('cmykC').value = cmyk.c;
        document.getElementById('cmykM').value = cmyk.m;
        document.getElementById('cmykY').value = cmyk.y;
        document.getElementById('cmykK').value = cmyk.k;
    }
    
    isUpdatingColorInputs = false;
}

// RGB to Hex conversion
function rgbToHex(r, g, b) {
    r = Math.max(0, Math.min(255, r));
    g = Math.max(0, Math.min(255, g));
    b = Math.max(0, Math.min(255, b));
    return '#' + [r, g, b].map(x => {
        const hex = x.toString(16);
        return hex.length === 1 ? '0' + hex : hex;
    }).join('');
}

// RGB to CMYK conversion
function rgbToCmyk(r, g, b) {
    let c = 1 - (r / 255);
    let m = 1 - (g / 255);
    let y = 1 - (b / 255);
    let k = Math.min(c, m, y);
    
    if (k === 1) {
        c = m = y = 0;
    } else {
        c = Math.round(((c - k) / (1 - k)) * 100);
        m = Math.round(((m - k) / (1 - k)) * 100);
        y = Math.round(((y - k) / (1 - k)) * 100);
        k = Math.round(k * 100);
    }
    
    return { c, m, y, k };
}

// CMYK to RGB conversion
function cmykToRgb(c, m, y, k) {
    c = c / 100;
    m = m / 100;
    y = y / 100;
    k = k / 100;
    
    const r = Math.round(255 * (1 - c) * (1 - k));
    const g = Math.round(255 * (1 - m) * (1 - k));
    const b = Math.round(255 * (1 - y) * (1 - k));
    
    return { r, g, b };
}

// Save color from modal
function saveColorFromModal() {
    const hex = document.getElementById('hexInput').value;
    
    if (!currentColorPickerTicketId || !hex) return;
    
    // Add to custom colors if not already present
    if (!customColors.includes(hex)) {
        customColors.push(hex);
        saveCustomColors();
    }
    
    // Apply color to ticket
    changeTicketColor(currentColorPickerTicketId, hex);
    renderTickets();
    
    // Close modal
    const modal = bootstrap.Modal.getInstance(document.getElementById('colorPickerModal'));
    modal.hide();
    
    currentColorPickerTicketId = null;
}

// Add custom color (legacy function - now opens modal)
function addCustomColor(ticketId) {
    openColorPickerModal(ticketId);
}

// Remove custom color
function removeCustomColor(color) {
    const index = customColors.indexOf(color);
    if (index > -1) {
        customColors.splice(index, 1);
        saveCustomColors();
        
        // Update any tickets using this color to white
        tickets.forEach(ticket => {
            if (ticket.color === color) {
                changeTicketColor(ticket.id, 'white');
            }
        });
        
        renderTickets();
    }
}

// Clear all custom colors
function clearAllCustomColors() {
    showConfirm(
        'Clear All Custom Colors?',
        'This will remove all custom colors from your palette.',
        () => {
            // Reset tickets with custom colors to white
            tickets.forEach(ticket => {
                if (ticket.color.startsWith('#')) {
                    changeTicketColor(ticket.id, 'white');
                }
            });
            
            customColors = [];
            saveCustomColors();
            renderTickets();
        }
    );
}

// Save all steps at once
async function saveAllSteps() {
    try {
        // Get all step inputs and update them
        const stepInputs = document.querySelectorAll('.simple-step-input');
        const updatePromises = [];
        
        stepInputs.forEach(input => {
            const stepId = parseInt(input.dataset.stepId);
            const stepName = input.value.trim();
            const step = steps.find(s => s.id === stepId);
            
            if (step && step.name !== stepName) {
                updatePromises.push(
                    fetch(`${API_URL}/steps/${stepId}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ name: stepName })
                    })
                );
                step.name = stepName;
            }
        });
        
        await Promise.all(updatePromises);
        
        // Persist numbering settings along with step updates
        saveAppSettings();

        renderTickets(); // Re-render tickets with updated steps
        
        // Clear change tracking
        changeLog = [];
        hasUnsavedChanges = false;
        originalSteps = JSON.parse(JSON.stringify(steps));
        
        // Update button state (no unsaved changes) and animate
        hasUnsavedChanges = false;
        updateSaveButtonState();
        const btn = document.getElementById('saveStepsBtn');
        const icon = btn.querySelector('i');
        btn.classList.add('saved');
        icon.className = 'bi bi-check-lg';
        setTimeout(() => {
            btn.classList.remove('saved');
            icon.className = 'bi bi-floppy';
            updateSaveButtonState();
        }, 2000);
    } catch (error) {
        console.error('Error saving steps:', error);
        showError('Failed to save steps.');
    }
}

// Update Save Changes button enabled/disabled state and appearance
function updateSaveButtonState() {
    const btn = document.getElementById('saveStepsBtn');
    const icon = btn?.querySelector('i');
    if (!btn || !icon) return;
    // Always restore default icon when updating state
    icon.className = 'bi bi-floppy';
    // Keep any transient 'saved' animation class if present; do not remove here
    const dirty = !!hasUnsavedChanges || (Array.isArray(changeLog) && changeLog.length > 0);
    if (dirty) {
        btn.disabled = false;
        btn.classList.remove('btn-secondary');
        btn.classList.add('btn-primary');
    } else {
        btn.disabled = true;
        btn.classList.remove('btn-primary');
        btn.classList.add('btn-secondary');
    }
}

// ======================
// Export/Import Utilities
// ======================

let pendingExport = null; // {type, format, content, blobBuilder}
let currentImportContext = null; // {type, format}

// Build configuration object
function buildConfigurationData() {
    return {
        steps: steps,
        customColors: customColors,
        tickets: { items: tickets.map((t, i) => ({ ticket_number: t.ticket_number, order_index: (typeof t.order_index === 'number' ? t.order_index : i) })) },
        exportDate: new Date().toISOString()
    };
}

// Build notes data (live snapshot from DOM to avoid stale state during typing)
function buildNotesData() {
    return tickets.map(t => {
        const row = document.getElementById(`ticket-${t.id}`);
        let liveNotes = t.notes || '';
        if (row) {
            const ta = row.querySelector('.ticket-notes');
            if (ta && typeof ta.value === 'string') liveNotes = ta.value;
        }
        return {
            ticket_number: t.ticket_number,
            step: steps.find(s => s.id === t.current_step_id)?.name || '',
            notes: liveNotes
        };
    });
}

function toToml(obj) {
    // Minimal TOML generator for our shapes
    const lines = [];
    if (obj.steps) {
        lines.push('[steps]');
        obj.steps.forEach((s) => {
            lines.push(`[[steps.items]]`);
            lines.push(`id = ${s.id}`);
            lines.push(`name = \"${(s.name || '').replace(/\"/g,'\\\"')}\"`);
            lines.push(`order_index = ${s.order_index}`);
        });
    }
    if (obj.tickets && obj.tickets.items) {
        lines.push('[tickets]');
        obj.tickets.items.forEach((t) => {
            lines.push('[[tickets.items]]');
            lines.push(`ticket_number = ${t.ticket_number}`);
            lines.push(`order_index = ${t.order_index}`);
        });
    }
    if (obj.customColors) {
        lines.push(`customColors = [${obj.customColors.map(c => `\"${c}\"`).join(', ')}]`);
    }
    if (obj.exportDate) lines.push(`exportDate = \"${obj.exportDate}\"`);
    return lines.join('\n');
}

function notesToCsv(rows) {
    // CSV header and rows
    const esc = (v) => '"' + String(v ?? '').replace(/"/g,'""').replace(/\n/g,'\\n') + '"';
    const header = ['ticket_number','step','notes'];
    const lines = [header.join(',')];
    rows.forEach(r => lines.push([r.ticket_number, esc(r.step), esc(r.notes)].join(',')));
    return lines.join('\n');
}

function buildNotesHtmlTable(rows) {
    const esc = (s) => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const head = '<thead class="table-dark"><tr><th style="width:100px">Ticket #</th><th style="width:160px">Step</th><th>Notes</th></tr></thead>';
    const body = `<tbody>${rows.map(r => `<tr><td>${esc(r.ticket_number)}</td><td>${esc(r.step)}</td><td style="white-space:pre-wrap">${esc(r.notes)}</td></tr>`).join('')}</tbody>`;
    return `<div class="table-responsive"><table class="table table-sm table-bordered">${head}${body}</table></div>`;
}

function openExportPreview(type, format) {
    const previewModal = new bootstrap.Modal(document.getElementById('previewModal'));
    const pre = document.getElementById('previewContent');
    const htmlDiv = document.getElementById('previewHtmlContent');
    document.getElementById('previewModalTitle').textContent = `Preview ${type} as ${format.toUpperCase()}`;

    let content = '';
    pendingExport = { type, format, content: null, blobBuilder: null };

    if (type === 'configuration') {
        const data = buildConfigurationData();
        if (format === 'json') {
            content = JSON.stringify(data, null, 2);
            pendingExport.content = content;
            pendingExport.blobBuilder = () => new Blob([content], {type:'application/json'});
            pre.style.display = 'block'; htmlDiv.style.display = 'none';
            pre.textContent = content;
        } else if (format === 'toml') {
            content = toToml(data);
            pendingExport.content = content;
            pendingExport.blobBuilder = () => new Blob([content], {type:'application/toml'});
            pre.style.display = 'block'; htmlDiv.style.display = 'none';
            pre.textContent = content;
        }
    } else if (type === 'notes') {
        const rows = buildNotesData();
        if (format === 'csv') {
            content = notesToCsv(rows);
            pendingExport.content = content;
            pendingExport.blobBuilder = () => new Blob([content], {type:'text/csv'});
            pre.style.display = 'block'; htmlDiv.style.display = 'none';
            pre.textContent = content;
        } else if (format === 'pdf') {
            // Build nice table using jsPDF + AutoTable
            pendingExport.blobBuilder = () => {
                const { jsPDF } = window.jspdf || {};
                const doc = new jsPDF({ unit:'pt', format:'a4', orientation: 'portrait' });
                const margin = 40;
                doc.setFontSize(14);
                doc.text('Ticket Notes', margin, margin);
                const head = [['Ticket #','Step','Notes']];
                const body = rows.map(r => [String(r.ticket_number), String(r.step || ''), String(r.notes || '')]);
                if (doc.autoTable) {
                    doc.autoTable({
                        startY: margin + 20,
                        head,
                        body,
                        styles: { fontSize: 10, cellPadding: 6, valign: 'top' },
                        headStyles: { fillColor: [33,37,41], textColor: 255 },
                        columnStyles: { 0: { cellWidth: 80 }, 1: { cellWidth: 140 }, 2: { cellWidth: 'auto' } },
                        margin: { left: margin, right: margin }
                    });
                }
                return doc.output('blob');
            };
            // HTML table preview
            pre.style.display = 'none'; htmlDiv.style.display = 'block';
            htmlDiv.innerHTML = buildNotesHtmlTable(rows);
        } else if (format === 'docx') {
            // Build DOCX table
            pendingExport.blobBuilder = async () => {
                const docx = window.docx;
                const headerRow = new docx.TableRow({
                    children: [
                        new docx.TableCell({ children: [new docx.Paragraph({ children:[new docx.TextRun({text:'Ticket #', bold:true})] })] }),
                        new docx.TableCell({ children: [new docx.Paragraph({ children:[new docx.TextRun({text:'Step', bold:true})] })] }),
                        new docx.TableCell({ children: [new docx.Paragraph({ children:[new docx.TextRun({text:'Notes', bold:true})] })] })
                    ]
                });
                const dataRows = rows.map(r => new docx.TableRow({
                    children: [
                        new docx.TableCell({ children:[ new docx.Paragraph(String(r.ticket_number)) ] }),
                        new docx.TableCell({ children:[ new docx.Paragraph(String(r.step || '')) ] }),
                        new docx.TableCell({ children:[ new docx.Paragraph(String(r.notes || '')) ] })
                    ]
                }));
                const table = new docx.Table({ width: { size: 100, type: docx.WidthType.PERCENTAGE }, rows: [headerRow, ...dataRows] });
                const doc = new docx.Document({ sections: [{ properties: {}, children: [new docx.Paragraph({ text: 'Ticket Notes', heading: docx.HeadingLevel.HEADING_2 }), table] }] });
                const blob = await docx.Packer.toBlob(doc);
                return blob;
            };
            // HTML table preview
            pre.style.display = 'none'; htmlDiv.style.display = 'block';
            htmlDiv.innerHTML = buildNotesHtmlTable(rows);
        }
    }

    // Bind download
    const downloadBtn = document.getElementById('confirmExportDownloadBtn');
    const newBtn = downloadBtn.cloneNode(true);
    downloadBtn.parentNode.replaceChild(newBtn, downloadBtn);
    newBtn.addEventListener('click', async () => {
        if (!pendingExport || !pendingExport.blobBuilder) return;
        const blob = pendingExport.blobBuilder.constructor.name === 'AsyncFunction' ? await pendingExport.blobBuilder() : pendingExport.blobBuilder();
        const ext = pendingExport.format;
        const type = pendingExport.type;
        const a = document.createElement('a');
        const url = URL.createObjectURL(blob);
        a.href = url;
        a.download = `${type}-${new Date().toISOString().split('T')[0]}.${ext}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    });

    previewModal.show();
}


// Existing export (simple JSON) kept for quick action
function exportSettings() {
    const settings = buildConfigurationData();
    const dataStr = JSON.stringify(settings, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ticket-manager-settings-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// Import handler: auto-detects configuration vs notes and JSON vs TOML
async function importSettings(event) {
    const file = event.target.files[0];
    if (!file) return;
    try {
        const text = await file.text();
        const ext = (file.name.split('.').pop() || '').toLowerCase();

        // Attempt parsing based on extension, with fallback to the other format
        let parsed = null;
        let isToml = false;
        if (ext === 'json') {
            try { parsed = JSON.parse(text); } catch {}
            if (parsed == null && window.TOML) { try { parsed = window.TOML.parse(text); isToml = true; } catch {} }
        } else if (ext === 'toml') {
            if (window.TOML) { try { parsed = window.TOML.parse(text); isToml = true; } catch {} }
            if (parsed == null) { try { parsed = JSON.parse(text); isToml = false; } catch {} }
        } else {
            try { parsed = JSON.parse(text); } catch {}
            if (parsed == null && window.TOML) { try { parsed = window.TOML.parse(text); isToml = true; } catch {} }
        }

        if (parsed == null) throw new Error('Unable to parse file as JSON or TOML.');

        // Detection for TOML using existing normalizers
        if (isToml) {
            const notesToml = parseNotesToml(text);
            if (Array.isArray(notesToml)) {
                await importNotes(notesToml);
                showSuccess('Notes imported.');
                return;
            }
            const configToml = parseConfigurationToml(text);
            if (configToml && typeof configToml === 'object' && configToml.steps) {
                await importConfiguration(configToml);
                return;
            }
            throw new Error('Unrecognized TOML structure.');
        }

        // Detection for JSON
        if (Array.isArray(parsed)) {
            // Assume notes array
            await importNotes(parsed);
            showSuccess('Notes imported.');
            return;
        } else if (parsed && typeof parsed === 'object') {
            if (Array.isArray(parsed.notes)) {
                await importNotes(parsed.notes);
                showSuccess('Notes imported.');
                return;
            }
            if (Array.isArray(parsed.steps)) {
                await importConfiguration(parsed);
                return;
            }
            if (Array.isArray(parsed.items)) {
                const first = parsed.items[0] || {};
                if (typeof first.ticket_number !== 'undefined' || typeof first.notes !== 'undefined') {
                    await importNotes(parsed.items);
                    showSuccess('Notes imported.');
                    return;
                } else if (typeof first.id !== 'undefined' || typeof first.name !== 'undefined' || typeof first.order_index !== 'undefined') {
                    const settings = { steps: parsed.items, customColors: parsed.customColors || [], exportDate: parsed.exportDate || new Date().toISOString() };
                    await importConfiguration(settings);
                    return;
                }
            }
        }

        throw new Error('Unrecognized file structure.');
    } catch (error) {
        console.error('Error importing file:', error);
        showError('Failed to import file. Make sure it is valid and contains configuration or notes.');
    } finally {
        // Reset file input
        event.target.value = '';
    }
}

function parseConfigurationToml(text) {
    if (!window.TOML) return null;
    try {
        const parsed = window.TOML.parse(text);
        const out = { steps: [], tickets: { items: [] }, customColors: parsed.customColors || [], exportDate: parsed.exportDate || new Date().toISOString() };
        if (parsed.steps && Array.isArray(parsed.steps.items)) {
            out.steps = parsed.steps.items.map(it => ({ id: it.id || 0, name: it.name || '', order_index: it.order_index || 0 }));
        }
        if (parsed.tickets && Array.isArray(parsed.tickets.items)) {
            out.tickets.items = parsed.tickets.items.map(it => ({ ticket_number: it.ticket_number, order_index: it.order_index || 0 }));
        }
        return out;
    } catch (e) { console.error('TOML parse error', e); return null; }
}

function parseNotesToml(text) {
    if (!window.TOML) return null;
    try {
        const parsed = window.TOML.parse(text);
        if (Array.isArray(parsed.notes)) return parsed.notes;
        if (parsed.items && Array.isArray(parsed.items)) return parsed.items;
        return null;
    } catch (e) { console.error('TOML parse error', e); return null; }
}

async function importConfiguration(settings) {
    if (!settings || (!settings.steps && !(settings.tickets && settings.tickets.items))) { showError('Invalid configuration.'); return; }
    showConfirm('Import Settings?', 'This will replace your current steps and custom colors, and update ticket order.', async () => {
        // Import custom colors
        if (settings.customColors) {
            customColors = settings.customColors;
            saveCustomColors();
        }
        // Replace steps if provided
        if (Array.isArray(settings.steps)) {
            for (const step of steps) {
                await deleteStep(step.id);
            }
            for (const step of settings.steps) {
                await fetch(`${API_URL}/steps`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: step.name, order_index: step.order_index })
                });
            }
            await loadSteps();
        }
        // Update ticket ordering if provided
        if (settings.tickets && Array.isArray(settings.tickets.items)) {
            // Map ticket_number to order_index
            const map = new Map(settings.tickets.items.map(it => [it.ticket_number, it.order_index]));
            // Update all matching tickets
            for (const t of tickets) {
                if (map.has(t.ticket_number)) {
                    const idx = map.get(t.ticket_number);
                    t.order_index = idx;
                    await updateTicket(t.id, { order_index: idx });
                }
            }
        }
        await loadTickets();
        showSuccess('Settings imported successfully!');
    });
}

async function importNotes(notes) {
    // Notes items: {ticket_number, step, notes}
    const stepByName = new Map(steps.map(s => [s.name, s.id]));
    for (const n of notes) {
        const t = tickets.find(x => x.ticket_number === n.ticket_number);
        if (!t) continue;
        const updates = {};
        if (typeof n.notes === 'string') { updates.notes = n.notes; t.notes = n.notes; }
        if (n.step && stepByName.has(n.step)) {
            const id = stepByName.get(n.step);
            updates.current_step_id = id; t.current_step_id = id;
        }
        if (Object.keys(updates).length) await updateTicket(t.id, updates);
    }
    renderTickets();
}

// Add a new step
async function addStep() {
    try {
        const stepData = {
            name: '',
            order_index: steps.length
        };
        
        const response = await fetch(`${API_URL}/steps`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(stepData)
        });
        
        const newStep = await response.json();
        steps.push(newStep);
        
        // Log change
        changeLog.push({
            type: 'added',
            step: newStep,
            description: `Added new step`
        });
        hasUnsavedChanges = true;
        updateSaveButtonState();
        
        renderSteps();
        renderTickets(); // Re-render tickets to update step dropdowns
        
        // Focus on the new input
        setTimeout(() => {
            const newInput = document.querySelector(`#step-input-${newStep.id}`);
            if (newInput) newInput.focus();
        }, 100);
    } catch (error) {
        console.error('Error adding step:', error);
        showError('Failed to add step.');
    }
}

// Update step
async function updateStep(stepId, name) {
    try {
        await fetch(`${API_URL}/steps/${stepId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
        });
        
        const step = steps.find(s => s.id === stepId);
        if (step) {
            step.name = name;
        }
        
        renderTickets(); // Re-render tickets to update step dropdowns
    } catch (error) {
        console.error('Error updating step:', error);
        showError('Failed to update step.');
    }
}

// Delete step (with undo support)
async function deleteStep(stepId, skipUndo = false) {
    try {
        const deletedStep = steps.find(s => s.id === stepId);
        const deletedIndex = steps.findIndex(s => s.id === stepId);
        
        // Save to undo history
        if (!skipUndo && deletedStep) {
            undoHistory.push({
                action: 'delete',
                step: JSON.parse(JSON.stringify(deletedStep))
            });
            
            // Log change
            changeLog.push({
                type: 'deleted',
                step: deletedStep,
                description: `Deleted step: "${deletedStep.name || 'Unnamed'}"`
            });
            
            updateUndoButton();
            hasUnsavedChanges = true;
            updateSaveButtonState();
        }
        
        await fetch(`${API_URL}/steps/${stepId}`, {
            method: 'DELETE'
        });
        
        steps = steps.filter(s => s.id !== stepId);
        
        // Update tickets that were using this step
        tickets.forEach(ticket => {
            if (ticket.current_step_id === stepId) {
                ticket.current_step_id = null;
            }
        });
        
        renderSteps();

        // Offer Undo via toast (re-adds step; does not restore prior ticket associations)
        if (deletedStep && !skipUndo) {
            showUndoToast('Step removed.', async () => {
                const response = await fetch(`${API_URL}/steps`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: deletedStep.name, order_index: Math.max(0, deletedIndex) })
                });
                if (!response.ok) throw new Error('Failed to undo deletion');
                await loadSteps();
                hasUnsavedChanges = true;
                updateSaveButtonState();
                ariaAnnounce(`Restored step '${deletedStep.name || ''}'.`);
            });
        }
    } catch (error) {
        console.error('Error deleting step:', error);
        showError('Failed to delete step.');
    }
}

// Render all tickets
function renderTickets() {
    const container = document.getElementById('ticketContainer');
    
    if (tickets.length === 0) {
        container.style.display = 'block';
        container.innerHTML = `
            <div class="empty-state">
                <i class="bi bi-inbox"></i>
                <h5>No tickets yet</h5>
                <p>Click the + button to add your first ticket</p>
            </div>
        `;
        return;
    }
    
    container.style.display = 'grid';
    
    container.innerHTML = tickets.map(ticket => createTicketHTML(ticket)).join('');
    
    // Attach event listeners
    tickets.forEach(ticket => {
        const row = document.getElementById(`ticket-${ticket.id}`);
        
        // Setup sliding quick color picker
        setupSlidingQuickPicker(row, ticket);

        // Editable ticket number when enabled
        const numEl = row.querySelector('.ticket-number');
        if (numEl && appSettings.customNumbering) {
            numEl.style.cursor = 'text';
            numEl.title = 'Click to edit number';
            numEl.addEventListener('click', () => startEditTicketNumber(ticket.id));
        }
        
        // Notes update
        const notesTextarea = row.querySelector('.ticket-notes');
        notesTextarea.addEventListener('input', (e) => {
            updateTicketNotes(ticket.id, e.target.value);
        });
        
        // Step navigation arrows
        const leftArrow = row.querySelector('.step-arrow-left');
        const rightArrow = row.querySelector('.step-arrow-right');
        
        if (leftArrow) {
            leftArrow.addEventListener('click', () => {
                changeTicketStep(ticket.id, 'left');
            });
        }
        
        if (rightArrow) {
            rightArrow.addEventListener('click', () => {
                changeTicketStep(ticket.id, 'right');
            });
        }
        
        // Click to select ticket
        row.addEventListener('click', (e) => {
            // Don't select if clicking interactive elements
            if (e.target.closest('input') || 
                e.target.closest('textarea') || 
                e.target.closest('button')) {
                return;
            }
            
            // Enter selection mode if not already in it
            if (!isSelectionMode) {
                enterSelectionMode();
            }
            
            toggleSelectionModeTicket(ticket.id);
        });
        
        // Apply text color based on background
        applyTextColorForBackground(row, ticket.color);
        
        // Setup drag and drop
        setupDragAndDrop(ticket.id);
    });
}


// Create HTML for a single ticket
function createTicketHTML(ticket) {
    // Handle custom colors (hex values) vs preset colors
    const isCustomColor = ticket.color.startsWith('#');
    const colorClass = isCustomColor ? '' : `bg-${ticket.color}`;
    const inlineStyle = isCustomColor ? `style="background-color: ${ticket.color};"` : '';
    const ticketNumberFormatted = String(ticket.ticket_number).padStart(2, '0');
    
    // Get current step info
    const currentStep = steps.find(s => s.id === ticket.current_step_id);
    const currentStepIndex = steps.findIndex(s => s.id === ticket.current_step_id);
    const stepName = currentStep ? currentStep.name : 'No step';
    const isFirstStep = currentStepIndex === 0;
    const isLastStep = currentStepIndex === steps.length - 1;
    const hasSteps = steps.length > 0;
    
    // Create step navigator HTML
    let stepNavigatorHTML;
    if (hasSteps) {
        // Allow navigation even if no step is set
        const disableLeft = currentStep && isFirstStep;
        const disableRight = currentStep && isLastStep;
        
        stepNavigatorHTML = `
            <div class="step-navigator">
                <button class="step-arrow step-arrow-left" ${disableLeft ? 'disabled' : ''}>
                    <i class="bi bi-chevron-left"></i>
                </button>
                <span class="step-name">${stepName}</span>
                <button class="step-arrow step-arrow-right" ${disableRight ? 'disabled' : ''}>
                    <i class="bi bi-chevron-right"></i>
                </button>
            </div>
        `;
    } else {
        stepNavigatorHTML = `
            <div class="step-navigator">
                <span class="no-steps">Configure steps in Settings</span>
            </div>
        `;
    }
    
    // Color options - preset colors
    const presetColors = DEFAULT_COLORS;
    const presetColorOptionsHTML = presetColors.map(color => `
        <div class="color-option ${ticket.color === color ? 'selected' : ''}" 
             data-color="${color}" 
             style="background-color: ${getColorValue(color)}; ${color === 'white' ? 'border: 2px solid #dee2e6;' : ''}" 
             title="${color}">
        </div>
    `).join('');
    
    // Custom colors with remove button
    const customColorOptionsHTML = customColors.map(color => `
        <div class="color-option-wrapper">
            <div class="color-option ${ticket.color === color ? 'selected' : ''}" 
                 data-color="${color}" 
                 style="background-color: ${color};"
                 title="Custom color">
            </div>
            <button class="remove-color-btn" data-remove-color="${color}" title="Remove this color">
                <i class="bi bi-x"></i>
            </button>
        </div>
    `).join('');
    
    // Add custom color button and clear all button
    let addColorHTML = `
        <div class="add-color-btn" title="Add custom color">
            <i class="bi bi-plus-circle"></i>
        </div>
    `;
    
    // Show clear all button only if there are custom colors
    if (customColors.length > 0) {
        addColorHTML += `
            <div class="clear-all-colors-btn" title="Clear all custom colors">
                <i class="bi bi-trash"></i>
            </div>
        `;
    }
    
    const colorOptionsHTML = presetColorOptionsHTML + customColorOptionsHTML + addColorHTML;
    
    return `
        <div id="ticket-${ticket.id}" class="ticket-row ${colorClass}" ${inlineStyle}>
            <div class="ticket-header">
                <div class="ticket-number">${ticketNumberFormatted}</div>
                <div class="quick-color-picker" data-ticket-id="${ticket.id}"></div>
            </div>
            
            <div class="ticket-content">
                ${stepNavigatorHTML}
                
                <textarea class="ticket-notes" placeholder="Enter notes for this ticket...">${ticket.notes || ''}</textarea>
            </div>
        </div>
    `;
}

// Setup sliding quick color picker for a ticket
function setupSlidingQuickPicker(row, ticket) {
    const picker = row.querySelector('.quick-color-picker');
    if (!picker) return;
    
    // Create the selected color circle (current color + icon overlay)
    const selectedCircle = document.createElement('div');
    selectedCircle.className = 'selected-color-circle';
    selectedCircle.style.backgroundColor = ticket.color.startsWith('#') ? ticket.color : getColorValue(ticket.color);
    selectedCircle.title = 'Hover to select color';
    const icon = document.createElement('img');
    icon.src = 'assets/colorwheel.png';
    icon.alt = 'selected colorwheel';
    icon.className = 'selected-icon';
    selectedCircle.appendChild(icon);
    
    // Create the expanded palette (hidden by default) inside a wrapper to control clipping
    const paletteWrap = document.createElement('div');
    paletteWrap.className = 'palette-wrap';
    const palette = document.createElement('div');
    palette.className = 'color-palette';
    paletteWrap.appendChild(palette);
    
    // Add custom color button first
    const customBtn = document.createElement('div');
    customBtn.className = 'quick-color-circle quick-color-custom';
    customBtn.innerHTML = '<i class="bi bi-plus"></i>';
    customBtn.title = 'Custom color';
    customBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openColorPickerModal(ticket.id);
    });
    palette.appendChild(customBtn);
    
    // Add preset colors: pink, orange, yellow, blue (in that order)
    const colors = DEFAULT_COLORS;
    colors.forEach(color => {
        const circle = document.createElement('div');
        circle.className = 'quick-color-circle';
        circle.dataset.color = color;
        const value = (typeof color === 'string' && color.startsWith('#')) ? color : getColorValue(color);
        circle.style.backgroundColor = value;
        circle.title = color.charAt(0).toUpperCase() + color.slice(1);
        
        // Hover preview
        circle.addEventListener('mouseenter', () => {
            const originalColor = ticket.color;
            setTicketRowColorUI(row, color);
            selectedCircle.style.backgroundColor = (typeof color === 'string' && color.startsWith('#')) ? color : getColorValue(color);
            
            circle.addEventListener('mouseleave', () => {
                if (!circle.dataset.clicked) {
                    setTicketRowColorUI(row, originalColor);
                    selectedCircle.style.backgroundColor = originalColor.startsWith('#') ? originalColor : getColorValue(originalColor);
                }
            }, { once: true });
        });
        
        // Click to persist
        circle.addEventListener('click', (e) => {
            e.stopPropagation();
            circle.dataset.clicked = 'true';
            changeTicketColor(ticket.id, color);
            selectedCircle.style.backgroundColor = (typeof color === 'string' && color.startsWith('#')) ? color : getColorValue(color);
        });
        
        palette.appendChild(circle);
    });
    
    // Clear and rebuild picker
    picker.innerHTML = '';
    // Order: palette (wrapped) first, selected circle last (rightmost)
    picker.appendChild(paletteWrap);
    picker.appendChild(selectedCircle);

    // Dynamic width calculation for expanded state using real DOM sizes (for palette only)
    function computeExpandedWidth() {
        // Sum widths of palette children + gaps
        const children = Array.from(palette.children);
        const gapStr = getComputedStyle(palette).columnGap || getComputedStyle(palette).gap || '0px';
        const gap = parseInt(gapStr) || 0;
        const childrenWidth = children.reduce((sum, el) => sum + el.offsetWidth, 0);
        const totalPaletteWidth = childrenWidth + gap * Math.max(0, children.length - 1);
        // Add buffer to avoid clipping at both ends and during hover scale
        return totalPaletteWidth + 28;
    }

    // Fluid open/close behavior for palette
    picker.addEventListener('mouseenter', () => {
        // Close any other open picker immediately
        if (activeQuickPicker && activeQuickPicker !== picker) {
            collapseActivePicker(true);
        }
        activeQuickPicker = picker;
        activePaletteWrap = paletteWrap;
        ensurePickerPointerTracking();

        picker.classList.add('expanded');
        paletteWrap.style.maxWidth = computeExpandedWidth() + 'px';
        // prevent dragging while expanded
        row.classList.add('no-drag');
    });

    picker.addEventListener('mouseleave', () => {
        // Schedule a quick collapse as a fallback; document mousemove will also close when far away
        collapseActivePicker(false);
    });
}

// Start editing ticket number
function startEditTicketNumber(ticketId) {
    const row = document.getElementById(`ticket-${ticketId}`);
    if (!row) return;
    const display = row.querySelector('.ticket-number');
    if (!display) return;
    const current = display.textContent.trim();
    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'ticket-number-input';
    input.value = parseInt(current, 10);
    display.replaceWith(input);
    input.focus();

    const finish = async (save) => {
        if (save) {
            const newNum = parseInt(input.value, 10);
            if (Number.isNaN(newNum) || newNum <= 0) { showError('Enter a positive number.'); return; }
            if (usedTicketNumbers.has(newNum)) { showError('That number is already in use.'); return; }
            // Update server
            try {
                await updateTicket(ticketId, { ticket_number: newNum });
                usedTicketNumbers.add(newNum);
                // Remove old number from set
                // find old
                const t = tickets.find(t => t.id === ticketId);
                if (t) usedTicketNumbers.delete(t.ticket_number);
                // Update local
                const ticket = tickets.find(t => t.id === ticketId);
                if (ticket) ticket.ticket_number = newNum;
            } catch (e) { showError('Failed to update ticket number.'); }
        }
        // Re-render to restore view
        renderTickets();
    };

    input.addEventListener('blur', () => finish(true));
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') finish(true);
        if (e.key === 'Escape') finish(false);
    });
}

// Get color hex value
function getColorValue(color) {
    const colors = {
        'white': '#ffffff',       // Legacy default
        'pink': '#ff69b4',        // Bright hot pink
        'orange': '#ff8c00',      // Bright dark orange
        'yellow': '#ffeb3b',      // Bright yellow
        'blue': '#2196f3'         // Bright blue
    };
    return colors[color] || '#ff69b4';
}

// Render steps in settings modal
function renderSteps() {
    const stepsList = document.getElementById('stepsList');
    if (stepsList) { stepsList.setAttribute('role','list'); stepsList.setAttribute('aria-label','Steps'); }
    
    if (steps.length === 0) {
        stepsList.innerHTML = `
            <div class="text-muted text-center py-3 empty-steps-message" role="note">
                <p>No steps yet. Click Add step to create your first step.</p>
            </div>
        `;
        return;
    }
    
    const setSize = steps.length;
    stepsList.innerHTML = steps.map((step, index) => `
        <div class="simple-step-item" data-step-id="${step.id}" role="listitem" aria-posinset="${index + 1}" aria-setsize="${setSize}">
            <span class="simple-step-handle" title="Drag to reorder" draggable="true" tabindex="0" role="button" aria-label="Reorder step"><i class="bi bi-grip-vertical"></i></span>
            <span class="simple-step-number">${index + 1}.</span>
            <input type="text" 
                   value="${step.name || ''}" 
                   id="step-input-${step.id}"
                   data-step-id="${step.id}" 
                   class="simple-step-input"
                   placeholder="Step ${index + 1}">
            <div class="simple-step-actions">
                <button class="simple-step-move simple-step-move-up" data-step-id="${step.id}" ${index === 0 ? 'disabled' : ''} aria-label="Move step up" title="Move up">
                    <i class="bi bi-arrow-up"></i>
                </button>
                <button class="simple-step-move simple-step-move-down" data-step-id="${step.id}" ${index === steps.length - 1 ? 'disabled' : ''} aria-label="Move step down" title="Move down">
                    <i class="bi bi-arrow-down"></i>
                </button>
                <button class="simple-step-delete" data-step-id="${step.id}" title="Delete step" aria-label="Delete step">
                    <i class="bi bi-x"></i>
                </button>
            </div>
        </div>
    `).join('');
    
    // Attach event listeners for step items
    steps.forEach(step => {
        const input = document.querySelector(`#step-input-${step.id}`);
        const deleteBtn = document.querySelector(`.simple-step-delete[data-step-id="${step.id}"]`);
        
        // Track edits live to enable Save Changes button
        input.addEventListener('input', () => {
            hasUnsavedChanges = true;
            updateSaveButtonState();
        });
        // Auto-save on input change (existing immediate save behavior)
        input.addEventListener('blur', () => {
            updateStep(step.id, input.value.trim());
        });
        
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                input.blur(); // Trigger save
            }
        });
        
        // Keyboard-accessible reordering from the input (Alt/Ctrl + Arrow Up/Down)
        input.addEventListener('keydown', async (e) => {
            if ((e.altKey || e.ctrlKey) && e.key === 'ArrowUp') {
                e.preventDefault();
                await moveStep(step.id, -1);
            } else if ((e.altKey || e.ctrlKey) && e.key === 'ArrowDown') {
                e.preventDefault();
                await moveStep(step.id, 1);
            }
        });
        
        // Move buttons (click)
        const upBtn = document.querySelector(`.simple-step-move-up[data-step-id="${step.id}"]`);
        const downBtn = document.querySelector(`.simple-step-move-down[data-step-id="${step.id}"]`);
        if (upBtn) upBtn.addEventListener('click', async () => { await moveStep(step.id, -1); });
        if (downBtn) downBtn.addEventListener('click', async () => { await moveStep(step.id, 1); });
        
        // Handle keyboard arrows on the drag handle as well
        const handle = document.querySelector(`.simple-step-item[data-step-id="${step.id}"] .simple-step-handle`);
        if (handle) {
            handle.addEventListener('keydown', async (e) => {
                if (e.key === 'ArrowUp') { e.preventDefault(); await moveStep(step.id, -1); }
                else if (e.key === 'ArrowDown') { e.preventDefault(); await moveStep(step.id, 1); }
            });
        }
        
        deleteBtn.addEventListener('click', () => {
            // Delete immediately without confirmation
            deleteStep(step.id);
        });
        });
    
    // Enable drag-and-drop reordering
    setupStepReordering();
    
    // Update Save button state on initial render
    updateSaveButtonState();
}

// Step reordering (drag and drop) helpers
function setupStepReordering() {
    const list = document.getElementById('stepsList');
    if (!list) return;
    const items = Array.from(list.querySelectorAll('.simple-step-item'));

    let draggingStepId = null;
    let lastIndicatorEl = null;
    let lastIndicatorPos = null; // 'before' | 'after'

    function clearIndicators() {
        items.forEach(it => it.classList.remove('reorder-before', 'reorder-after'));
        lastIndicatorEl = null;
        lastIndicatorPos = null;
    }

    items.forEach(item => {
        const stepId = parseInt(item.dataset.stepId);
        const handle = item.querySelector('.simple-step-handle');
        if (!handle) return;

        handle.addEventListener('dragstart', (e) => {
            draggingStepId = stepId;
            item.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            try { e.dataTransfer.setData('text/plain', String(stepId)); } catch {}
        });

        item.addEventListener('dragover', (e) => {
            if (!draggingStepId) return;
            e.preventDefault();
            const rect = item.getBoundingClientRect();
            const pos = (e.clientY > rect.top + rect.height / 2) ? 'after' : 'before';
            if (lastIndicatorEl !== item || lastIndicatorPos !== pos) {
                clearIndicators();
                item.classList.add(pos === 'after' ? 'reorder-after' : 'reorder-before');
                lastIndicatorEl = item;
                lastIndicatorPos = pos;
            }
        });

        item.addEventListener('dragleave', () => {
            // Remove indicator if leaving current item
            item.classList.remove('reorder-before', 'reorder-after');
        });

        item.addEventListener('drop', async (e) => {
            if (!draggingStepId) return;
            e.preventDefault();
            const targetId = stepId;
            if (targetId === draggingStepId) { clearIndicators(); return; }
            const rect = item.getBoundingClientRect();
            const pos = (e.clientY > rect.top + rect.height / 2) ? 'after' : 'before';

            const fromIdx = steps.findIndex(s => s.id === draggingStepId);
            let toIdx = steps.findIndex(s => s.id === targetId);
            if (fromIdx === -1 || toIdx === -1) { clearIndicators(); return; }

            // Compute insertion index
            let insertIdx = toIdx + (pos === 'after' ? 1 : 0);
            if (fromIdx < insertIdx) insertIdx--; // adjust for removal shift

            // Move in array
            const [moved] = steps.splice(fromIdx, 1);
            steps.splice(insertIdx, 0, moved);

            // Re-sequence order_index and persist
            const updates = [];
            steps.forEach((s, i) => { s.order_index = i; updates.push(updateStepOrder(s.id, i)); });
            try {
                await Promise.all(updates);
            } catch (err) {
                console.error('Error persisting step order', err);
                showError('Failed to save new step order.');
            }

            // Mark as having unsaved changes in the modal UI
            hasUnsavedChanges = true;
            if (Array.isArray(changeLog)) { changeLog.push({ type: 'reordered', description: 'Reordered steps' }); }
            updateSaveButtonState();

            // Announce reorder for a11y
            const label = (moved?.name || 'Step');
            const newPos = steps.findIndex(s => s.id === moved.id) + 1;
            ariaAnnounce(`Moved '${label}' to position ${newPos}.`);

            // Re-render list
            renderSteps();
        });

        handle.addEventListener('dragend', () => {
            draggingStepId = null;
            item.classList.remove('dragging');
            clearIndicators();
        });
    });
}

async function updateStepOrder(stepId, order_index) {
    try {
        await fetch(`${API_URL}/steps/${stepId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ order_index })
        });
        const s = steps.find(s => s.id === stepId);
        if (s) s.order_index = order_index;
    } catch (error) {
        console.error('Error updating step order:', error);
        throw error;
    }
}

// Move a step by delta (-1 up, +1 down), persist, and keep focus on the moved step
async function moveStep(stepId, delta) {
    const fromIdx = steps.findIndex(s => s.id === stepId);
    if (fromIdx === -1) return;
    const toIdx = fromIdx + delta;
    if (toIdx < 0 || toIdx >= steps.length) return;

    const [moved] = steps.splice(fromIdx, 1);
    steps.splice(toIdx, 0, moved);

    // Re-sequence and persist all order_index values
    const updates = [];
    steps.forEach((s, i) => { s.order_index = i; updates.push(updateStepOrder(s.id, i)); });
    try {
        await Promise.all(updates);
    } catch (err) {
        console.error('Error persisting step order', err);
        showError('Failed to save new step order.');
    }

    // Mark as having unsaved changes in the modal UI
    hasUnsavedChanges = true;
    if (Array.isArray(changeLog)) { changeLog.push({ type: 'reordered', description: 'Reordered steps' }); }
    updateSaveButtonState();

    // Announce reorder for a11y
    const label = (moved?.name || 'Step');
    const newPos = steps.findIndex(s => s.id === moved.id) + 1;
    ariaAnnounce(`Moved '${label}' to position ${newPos}.`);

    // Re-render and restore focus to the moved step's input
    renderSteps();
    setTimeout(() => {
        const input = document.querySelector(`#step-input-${stepId}`);
        if (input) input.focus();
    }, 0);
}

// Announce messages in a live region for accessibility
function ariaAnnounce(message) {
    const live = document.getElementById('ariaLiveRegion');
    if (!live) return;
    // Clear then set to ensure announcement fires
    live.textContent = '';
    setTimeout(() => { live.textContent = String(message || ''); }, 10);
}

// Lightweight toast with Undo action
let tmToastTimer = null;
function showUndoToast(message, onUndo) {
    if (tmToastTimer) { clearTimeout(tmToastTimer); tmToastTimer = null; }
    const old = document.getElementById('tmToast');
    if (old) old.remove();
    const toast = document.createElement('div');
    toast.id = 'tmToast';
    toast.className = 'tm-toast';
    toast.setAttribute('role','status');
    toast.setAttribute('aria-live','polite');
    const span = document.createElement('span');
    span.textContent = message || 'Action completed.';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Undo';
    btn.addEventListener('click', async () => {
        try { if (typeof onUndo === 'function') await onUndo(); } finally { toast.remove(); }
    });
    toast.appendChild(span);
    toast.appendChild(btn);
    document.body.appendChild(toast);
    tmToastTimer = setTimeout(() => { toast.remove(); }, 5000);
}

// Show error message
function showError(message) {
    alert(message);
}

// Show success message
function showSuccess(message) {
    alert(message);
}

// Enter selection mode
function enterSelectionMode() {
    isSelectionMode = true;
    document.body.classList.add('selection-mode');
    const overlay = document.getElementById('selectionOverlay');
    overlay.style.display = 'block';
    document.getElementById('dragDeleteZone').style.display = 'flex';
    document.getElementById('addTicketBtn').style.display = 'none';
    
    // Add click listener to overlay to exit selection mode
    overlay.addEventListener('click', handleOverlayClick);
}

// Handle overlay click
function handleOverlayClick(e) {
    // Only exit if clicking directly on the overlay (not propagated from tickets)
    if (e.target.id === 'selectionOverlay') {
        exitSelectionMode();
    }
}

// Exit selection mode
function exitSelectionMode() {
    isSelectionMode = false;
    document.body.classList.remove('selection-mode');
    const overlay = document.getElementById('selectionOverlay');
    overlay.style.display = 'none';
    document.getElementById('dragDeleteZone').style.display = 'none';
    document.getElementById('addTicketBtn').style.display = 'flex';
    
    // Remove click listener from overlay
    overlay.removeEventListener('click', handleOverlayClick);
    
    // Clear all selections
    selectedTickets.clear();
    tickets.forEach(ticket => {
        const row = document.getElementById(`ticket-${ticket.id}`);
        if (row) {
            row.classList.remove('selected-for-bulk');
            row.style.cursor = 'grab';
        }
    });
}

// Update undo button state
function updateUndoButton() { /* Undo button removed */ }

// Undo last step action
async function undoStepAction() { /* Undo functionality disabled */ }

// Handle settings modal close
function handleSettingsClose() {
    if (hasUnsavedChanges || changeLog.length > 0) {
        showDiscardChangesModal();
    } else {
        // No changes, close directly
        const modal = bootstrap.Modal.getInstance(document.getElementById('settingsModal'));
        modal.hide();
    }
}

// Show discard changes modal with change log
function showDiscardChangesModal() {
    const modal = new bootstrap.Modal(document.getElementById('confirmModal'));
    const titleEl = document.getElementById('confirmModalTitle');
    const messageEl = document.getElementById('confirmModalMessage');
    const confirmBtn = document.getElementById('confirmModalConfirm');
    
    titleEl.textContent = 'Discard Changes?';
    
    // Build change log
    let changeLogHTML = '<div class="text-start mt-2"><strong>Changes made:</strong><ul class="mb-0 mt-1">';
    changeLog.forEach(change => {
        changeLogHTML += `<li>${change.description}</li>`;
    });
    changeLogHTML += '</ul></div>';
    
    messageEl.innerHTML = changeLogHTML;
    
    // Remove old listeners and add new one
    const newConfirmBtn = confirmBtn.cloneNode(true);
    confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
    
    newConfirmBtn.textContent = 'Discard';
    newConfirmBtn.className = 'btn btn-danger flex-fill';
    
    newConfirmBtn.addEventListener('click', () => {
        modal.hide();
        // Reload steps from database to discard changes
        loadSteps();
        const settingsModal = bootstrap.Modal.getInstance(document.getElementById('settingsModal'));
        settingsModal.hide();
    });
    
    modal.show();
}

// Toggle ticket selection in selection mode
function toggleSelectionModeTicket(ticketId) {
    const row = document.getElementById(`ticket-${ticketId}`);
    if (!row) return;
    
    if (selectedTickets.has(ticketId)) {
        selectedTickets.delete(ticketId);
        row.classList.remove('selected-for-bulk');
    } else {
        selectedTickets.add(ticketId);
        row.classList.add('selected-for-bulk');
    }
    
    // Exit selection mode if no tickets are selected
    if (selectedTickets.size === 0) {
        exitSelectionMode();
    }
}

// Bulk delete tickets
function bulkDeleteTickets() {
    const count = selectedTickets.size;
    showConfirm(
        `Delete ${count} Ticket${count > 1 ? 's' : ''}?`,
        'This action cannot be undone.',
        async () => {
            const ticketIds = Array.from(selectedTickets);
            for (const ticketId of ticketIds) {
                await deleteTicket(ticketId);
            }
            selectedTickets.clear();
            updateSelectionUI();
        }
    );
}

// Helper: find ticket index by id
function getTicketIndexById(id) {
    return tickets.findIndex(t => t.id === id);
}

function moveTicketInArray(fromIdx, toIdx) {
    if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return false;
    const [item] = tickets.splice(fromIdx, 1);
    tickets.splice(toIdx, 0, item);
    // Reassign order_index sequentially and persist changes
    tickets.forEach((t, i) => { t.order_index = i; updateTicket(t.id, { order_index: i }); });
    return true;
}

// Setup drag and drop for ticket
function setupDragAndDrop(ticketId) {
    const row = document.getElementById(`ticket-${ticketId}`);
    if (!row) return;
    
    let startX, startY, isDraggingTicket = false;
    let dragGhost = null;
    
    row.addEventListener('mousedown', (e) => {
        
        // Don't start drag if clicking on interactive elements
        if (e.target.closest('.color-toggle-btn') || 
            e.target.closest('input') ||
            e.target.closest('textarea') ||
            e.target.closest('select') ||
            e.target.closest('button') ||
            e.target.closest('.color-picker-dropdown') ||
            e.target.closest('.quick-color-picker') ||
            row.classList.contains('no-drag')) {
            return;
        }
        
        isDraggingTicket = true;
        startX = e.clientX;
        startY = e.clientY;
        draggedTicketId = ticketId;
    });
    
    // Track a visual drop indicator
    let indicatorRowEl = null;
    let indicatorPos = null; // 'before' | 'after'

    function clearDropIndicator() {
        if (indicatorRowEl) {
            indicatorRowEl.classList.remove('drop-before', 'drop-after');
            indicatorRowEl = null;
            indicatorPos = null;
        }
    }

    function updateDropIndicator(clientX, clientY) {
        const deleteZone = document.getElementById('dragDeleteZone');
        if (deleteZone && deleteZone.classList.contains('active')) {
            clearDropIndicator();
            return;
        }
        const el = document.elementFromPoint(clientX, clientY);
        const targetRow = el ? (el.closest && el.closest('.ticket-row')) : null;
        if (!targetRow) { clearDropIndicator(); return; }
        // Decide before/after relative to row horizontal center
        const rect = targetRow.getBoundingClientRect();
        const pos = clientX > (rect.left + rect.width / 2) ? 'after' : 'before';
        if (indicatorRowEl !== targetRow || indicatorPos !== pos) {
            clearDropIndicator();
            indicatorRowEl = targetRow;
            indicatorPos = pos;
            targetRow.classList.add(pos === 'after' ? 'drop-after' : 'drop-before');
        }
    }

    document.addEventListener('mousemove', (e) => {
        if (!isDraggingTicket || !draggedTicketId) return;
        
        const deltaX = Math.abs(e.clientX - startX);
        const deltaY = Math.abs(e.clientY - startY);
        
        // Start drag if moved more than 5px (faster response)
        if (deltaX > 5 || deltaY > 5) {
            if (!isDragging) {
                isDragging = true;
                startDragMode();
                
                // In selection mode with multiple selections, create bulk ghost
                if (isSelectionMode && selectedTickets.size > 1) {
                    bulkDragGhost = document.createElement('div');
                    bulkDragGhost.className = 'bulk-drag-ghost';
                    
                    selectedTickets.forEach(id => {
                        const ticketRow = document.getElementById(`ticket-${id}`);
                        if (ticketRow) {
                            ticketRow.classList.add('dragging');
                            
                            const ghostTicket = document.createElement('div');
                            ghostTicket.className = 'ghost-ticket';
                            const ticket = tickets.find(t => t.id === id);
                            ghostTicket.textContent = ticket ? `Ticket ${String(ticket.ticket_number).padStart(2, '0')}` : `Ticket ${id}`;
                            bulkDragGhost.appendChild(ghostTicket);
                        }
                    });
                    
                    document.body.appendChild(bulkDragGhost);
                    dragGhost = bulkDragGhost;
                } else {
                    // Single ticket drag
                    const dragRow = document.getElementById(`ticket-${draggedTicketId}`);
                    if (dragRow) {
                        dragRow.classList.add('dragging');
                        
                        // Clone the ticket for dragging
                        dragGhost = dragRow.cloneNode(true);
                        dragGhost.classList.remove('dragging');
                        dragGhost.classList.add('drag-ghost');
                        dragGhost.style.width = dragRow.offsetWidth + 'px';
                        dragGhost.style.pointerEvents = 'none';
                        document.body.appendChild(dragGhost);
                    }
                }
            }
            
            // Update ghost position to follow cursor
            if (dragGhost) {
                dragGhost.style.left = (e.clientX - dragGhost.offsetWidth / 2) + 'px';
                dragGhost.style.top = (e.clientY - dragGhost.offsetHeight / 2) + 'px';
            }
            
            // Check proximity to delete zone
            checkDeleteZoneProximity(e.clientX, e.clientY);

            // Update drop indicator under cursor
            updateDropIndicator(e.clientX, e.clientY);
        }
    });
    
    document.addEventListener('mouseup', (e) => {
        if (isDraggingTicket) {
            isDraggingTicket = false;
            
            if (isDragging) {
                // Remove drag ghost
                if (dragGhost && dragGhost.parentNode) {
                    dragGhost.parentNode.removeChild(dragGhost);
                    dragGhost = null;
                }
                
                let handled = false;
                // Check if dropped in delete zone
                if (isOverDeleteZone(e.clientX, e.clientY)) {
                    handled = true;
                    if (isSelectionMode && selectedTickets.size > 1) {
                        // Multiple tickets - ask for confirmation
                        const count = selectedTickets.size;
                        showConfirm(
                            `Delete ${count} Tickets?`,
                            'This action cannot be undone.',
                            async () => {
                                const ticketIds = Array.from(selectedTickets);
                                for (const id of ticketIds) {
                                    await deleteTicket(id);
                                }
                                exitSelectionMode();
                            }
                        );
                    } else {
                        // Single ticket - delete immediately without confirmation
                        const ticketToDelete = draggedTicketId;
                        if (isSelectionMode && selectedTickets.size === 1) {
                            // Single selected ticket
                            const ticketId = Array.from(selectedTickets)[0];
                            deleteTicket(ticketId);
                            exitSelectionMode();
                        } else {
                            // Single dragged ticket
                            deleteTicket(ticketToDelete);
                        }
                    }
                }

                // If not deleted, try to reorder by dropping near another ticket
                if (!handled && draggedTicketId) {
                    const el = document.elementFromPoint(e.clientX, e.clientY);
                    const targetRow = el ? el.closest && el.closest('.ticket-row') : null;
                    let toIdx = -1;
                    if (targetRow) {
                        const targetId = parseInt(targetRow.id.replace('ticket-', ''), 10);
                        toIdx = getTicketIndexById(targetId);
                    } else {
                        // If dropped on empty space, append to end
                        toIdx = tickets.length - 1;
                    }
                    const fromIdx = getTicketIndexById(draggedTicketId);
                    if (fromIdx !== -1 && toIdx !== -1) {
                        // If dropping after itself, do nothing
                        if (fromIdx !== toIdx) {
                            // Decide before/after depending on horizontal center
                            let insertIdx = toIdx;
                            if (targetRow) {
                                const rect = targetRow.getBoundingClientRect();
                                const centerX = rect.left + rect.width / 2;
                                if (e.clientX > centerX) insertIdx = toIdx + (fromIdx < toIdx ? 0 : 1);
                                else insertIdx = toIdx + (fromIdx < toIdx ? -1 : 0);
                                insertIdx = Math.max(0, Math.min(tickets.length - 1, insertIdx));
                            }
                            moveTicketInArray(fromIdx, insertIdx);
                            renderTickets();
                        }
                    }
                }
                
                clearDropIndicator();
                endDragMode();
            }
            
            draggedTicketId = null;
        }
    });
}

// Start drag mode
function startDragMode() {
    const addBtn = document.getElementById('addTicketBtn');
    const deleteZone = document.getElementById('dragDeleteZone');
    
    addBtn.style.display = 'none';
    deleteZone.style.display = 'flex';
}

// End drag mode
function endDragMode() {
    const addBtn = document.getElementById('addTicketBtn');
    const deleteZone = document.getElementById('dragDeleteZone');
    
    isDragging = false;
    
    addBtn.style.display = 'flex';
    deleteZone.style.display = 'none';
    deleteZone.classList.remove('active');
    
    // Remove dragging class from all tickets
    document.querySelectorAll('.ticket-row.dragging').forEach(row => {
        row.classList.remove('dragging', 'drag-over-delete');
    });
    // Clear any drop indicators
    document.querySelectorAll('.ticket-row.drop-before, .ticket-row.drop-after').forEach(row => {
        row.classList.remove('drop-before', 'drop-after');
    });
}

// Check proximity to delete zone
function checkDeleteZoneProximity(mouseX, mouseY) {
    const deleteZone = document.getElementById('dragDeleteZone');
    const rect = deleteZone.getBoundingClientRect();
    
    // Expand detection area
    const expandedRect = {
        left: rect.left - 100,
        right: rect.right + 100,
        top: rect.top - 100,
        bottom: rect.bottom + 100
    };
    
    const isNear = mouseX >= expandedRect.left && 
                   mouseX <= expandedRect.right && 
                   mouseY >= expandedRect.top && 
                   mouseY <= expandedRect.bottom;
    
    if (isNear) {
        deleteZone.classList.add('active');
        if (draggedTicketId) {
            const dragRow = document.getElementById(`ticket-${draggedTicketId}`);
            if (dragRow) dragRow.classList.add('drag-over-delete');
        }
    } else {
        deleteZone.classList.remove('active');
        if (draggedTicketId) {
            const dragRow = document.getElementById(`ticket-${draggedTicketId}`);
            if (dragRow) dragRow.classList.remove('drag-over-delete');
        }
    }
}

// Check if dropped over delete zone
function isOverDeleteZone(mouseX, mouseY) {
    const deleteZone = document.getElementById('dragDeleteZone');
    const rect = deleteZone.getBoundingClientRect();
    
    // Use expanded rect for drop detection
    const expandedRect = {
        left: rect.left - 50,
        right: rect.right + 50,
        top: rect.top - 50,
        bottom: rect.bottom + 50
    };
    
    return mouseX >= expandedRect.left && 
           mouseX <= expandedRect.right && 
           mouseY >= expandedRect.top && 
           mouseY <= expandedRect.bottom;
}
