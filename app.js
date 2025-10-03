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
    document.getElementById('importSettingsBtn').addEventListener('click', () => {
        document.getElementById('importFileInput').click();
    });
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
    
    // Setup settings modal open event to capture original state
    const settingsModal = document.getElementById('settingsModal');
    settingsModal.addEventListener('show.bs.modal', () => {
        originalSteps = JSON.parse(JSON.stringify(steps));
        hasUnsavedChanges = false;
        undoHistory = [];
        changeLog = [];
        updateUndoButton();
        resetSaveButton();
    });
}

// Generate random two-digit ticket number
function generateRandomTicketNumber() {
    let number;
    do {
        number = Math.floor(Math.random() * 90) + 10; // Random number between 10-99
    } while (usedTicketNumbers.has(number));
    usedTicketNumbers.add(number);
    return number;
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
        const ticketData = {
            ticket_number: generateRandomTicketNumber(),
            color: 'white',
            notes: '',
            current_step_id: steps.length > 0 ? steps[0].id : null
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
        renderTickets(); // Re-render tickets with updated steps
        
        // Clear change tracking
        changeLog = [];
        hasUnsavedChanges = false;
        originalSteps = JSON.parse(JSON.stringify(steps));
        
        // Animate save button
        const btn = document.getElementById('saveStepsBtn');
        const icon = btn.querySelector('i');
        
        btn.classList.add('saved');
        icon.className = 'bi bi-check-lg';
        
        setTimeout(() => {
            btn.classList.remove('saved');
            icon.className = 'bi bi-floppy';
        }, 2000);
    } catch (error) {
        console.error('Error saving steps:', error);
        showError('Failed to save steps.');
    }
}

// Reset save button
function resetSaveButton() {
    const btn = document.getElementById('saveStepsBtn');
    const icon = btn?.querySelector('i');
    if (btn && icon) {
        btn.classList.remove('saved');
        btn.className = 'btn btn-primary';
        icon.className = 'bi bi-floppy';
    }
}

// Export settings to JSON
function exportSettings() {
    const settings = {
        steps: steps,
        customColors: customColors,
        exportDate: new Date().toISOString()
    };
    
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

// Import settings from JSON
async function importSettings(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    try {
        const text = await file.text();
        const settings = JSON.parse(text);
        
        if (!settings.steps) {
            showError('Invalid settings file.');
            return;
        }
        
        showConfirm(
            'Import Settings?',
            'This will replace your current steps and custom colors.',
            async () => {
                // Import custom colors
                if (settings.customColors) {
                    customColors = settings.customColors;
                    saveCustomColors();
                }
                
                // Clear existing steps
                for (const step of steps) {
                    await deleteStep(step.id);
                }
                
                // Import new steps
                for (const step of settings.steps) {
                    await fetch(`${API_URL}/steps`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            name: step.name,
                            order_index: step.order_index
                        })
                    });
                }
                
                // Reload everything
                await loadSteps();
                await loadTickets();
                
                showSuccess('Settings imported successfully!');
            }
        );
    } catch (error) {
        console.error('Error importing settings:', error);
        showError('Failed to import settings. Make sure the file is valid JSON.');
    }
    
    // Reset file input
    event.target.value = '';
}

// Update ticket notes
function updateTicketNotes(ticketId, notes) {
    updateTicket(ticketId, { notes });
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
        renderTickets();
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
        setupSlidingColorPicker(row, ticket);
        
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
    const presetColors = ['white', 'yellow', 'pink', 'blue', 'green', 'purple', 'orange'];
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

// Setup sliding color picker for a ticket
function setupSlidingColorPicker(row, ticket) {
    const picker = row.querySelector('.quick-color-picker');
    if (!picker) return;
    
    // Create the selected color circle (current color)
    const selectedCircle = document.createElement('div');
    selectedCircle.className = 'selected-color-circle';
    selectedCircle.style.backgroundColor = ticket.color.startsWith('#') ? ticket.color : getColorValue(ticket.color);
    selectedCircle.title = 'Current color - hover to change';
    // Add pulse ring element for click feedback
    const flashRing = document.createElement('span');
    flashRing.className = 'flash-ring';
    selectedCircle.appendChild(flashRing);
    
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
    
    // Add preset colors: hot pink, orange, yellow, blue (in that order)
    const colors = ['#ff69b4', 'orange', 'yellow', 'blue'];
    colors.forEach(color => {
        const circle = document.createElement('div');
        circle.className = 'quick-color-circle';
        circle.dataset.color = color;
        const value = (typeof color === 'string' && color.startsWith('#')) ? color : getColorValue(color);
        circle.style.backgroundColor = value;
        circle.title = (color.startsWith('#') ? 'Hot pink' : color.charAt(0).toUpperCase() + color.slice(1));
        
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
            // Trigger right-arc flash animation
            selectedCircle.classList.remove('flash');
            // force reflow to restart animation if already applied
            // eslint-disable-next-line no-unused-expressions
            selectedCircle.offsetWidth;
            selectedCircle.classList.add('flash');
            // Trigger pulse ring
            flashRing.classList.remove('pulse');
            // eslint-disable-next-line no-unused-expressions
            flashRing.offsetWidth;
            flashRing.classList.add('pulse');
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
        // Add small padding buffer
        return totalPaletteWidth + 8;
    }

    // Auto-collapse after 2 seconds when mouse leaves
    let collapseTimer;
    picker.addEventListener('mouseleave', () => {
        collapseTimer = setTimeout(() => {
            picker.classList.remove('expanded');
            paletteWrap.style.maxWidth = '0px';
            // allow dragging again after collapse
            row.classList.remove('no-drag');
        }, 2000);
    });
    
    picker.addEventListener('mouseenter', () => {
        clearTimeout(collapseTimer);
        picker.classList.add('expanded');
        paletteWrap.style.maxWidth = computeExpandedWidth() + 'px';
        // prevent dragging while expanded
        row.classList.add('no-drag');
    });
}

// Get color hex value
function getColorValue(color) {
    const colors = {
        'white': '#ffffff',
        'yellow': '#fff9c4',
        'pink': '#fce4ec',
        'blue': '#e3f2fd',
        'green': '#e8f5e9',
        'purple': '#f3e5f5',
        'orange': '#fff3e0'
    };
    return colors[color] || '#ffffff';
}

// Render steps in settings modal
function renderSteps() {
    const stepsList = document.getElementById('stepsList');
    
    if (steps.length === 0) {
        stepsList.innerHTML = `
            <div class="text-muted text-center py-3 empty-steps-message">
                <p>Click + to add your first step</p>
            </div>
        `;
        return;
    }
    
    stepsList.innerHTML = steps.map((step, index) => `
        <div class="simple-step-item">
            <span class="simple-step-number">${index + 1}.</span>
            <input type="text" 
                   value="${step.name || ''}" 
                   id="step-input-${step.id}"
                   data-step-id="${step.id}" 
                   class="simple-step-input"
                   placeholder="Step ${index + 1}">
            <button class="simple-step-delete" data-step-id="${step.id}" title="Delete step">
                <i class="bi bi-x"></i>
            </button>
        </div>
    `).join('');
    
    // Attach event listeners for step items
    steps.forEach(step => {
        const input = document.querySelector(`#step-input-${step.id}`);
        const deleteBtn = document.querySelector(`.simple-step-delete[data-step-id="${step.id}"]`);
        
        // Auto-save on input change
        input.addEventListener('blur', () => {
            updateStep(step.id, input.value.trim());
        });
        
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                input.blur(); // Trigger save
            }
        });
        
        deleteBtn.addEventListener('click', () => {
            // Delete immediately without confirmation
            deleteStep(step.id);
        });
    });
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
                
                // Check if dropped in delete zone
                if (isOverDeleteZone(e.clientX, e.clientY)) {
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
