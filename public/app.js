/**
 * Site Plan Tool
 * Mobile-first tool for field techs to mark IDU/ODU placement on satellite imagery
 */

// State
let canvas = null;
let installationId = null;
let authToken = null;
let googleMapsApiKey = null;
let currentTool = 'idu'; // 'idu', 'odu', 'line'
let iduPlaced = false;
let oduPlaced = false;
let linePoints = [];
let currentLine = null;

// DOM Elements
const loadingEl = document.getElementById('loading');
const errorEl = document.getElementById('error');
const errorMessageEl = document.getElementById('error-message');
const mainEl = document.getElementById('main');
const customerNameEl = document.getElementById('customer-name');
const addressEl = document.getElementById('address');
const saveBtn = document.getElementById('btn-save');
const successModal = document.getElementById('success-modal');

// Tool buttons
const btnIdu = document.getElementById('btn-idu');
const btnOdu = document.getElementById('btn-odu');
const btnLine = document.getElementById('btn-line');
const btnClear = document.getElementById('btn-clear');

/**
 * Initialize the app
 */
async function init() {
  // Get installation ID and auth token from URL
  const params = new URLSearchParams(window.location.search);
  installationId = params.get('id');
  authToken = params.get('token');
  const demoMode = params.get('demo') === 'true';

  if (!installationId && !demoMode) {
    showError('No installation ID provided. Add ?id=INSTALLATION_ID or ?demo=true to the URL.');
    return;
  }

  try {
    // Load config
    const config = await fetchConfig();
    googleMapsApiKey = config.googleMapsApiKey;

    let customerName = 'Demo Customer';
    let address = '123 Main St, Denver, CO 80202';
    let coordinates = null;

    // In demo mode, skip HubSpot lookup
    if (!demoMode && installationId) {
      const installation = await fetchInstallation(installationId);
      customerName = installation.name || 'Unknown';
      address = installation.address || 'No address';
      coordinates = installation.coordinates; // Pre-fetched lat/lng from Place
    }

    // Update UI with installation info
    customerNameEl.textContent = customerName;
    addressEl.textContent = address;

    // Show main content FIRST so canvas container has proper dimensions
    loadingEl.classList.add('hidden');
    mainEl.classList.remove('hidden');

    // Small delay to ensure layout is calculated
    await new Promise(resolve => requestAnimationFrame(resolve));

    // Initialize canvas (pass coordinates to skip geocoding if available)
    await initCanvas(address, coordinates);

    // Setup tool handlers
    setupToolHandlers();

  } catch (error) {
    console.error('Initialization error:', error);
    showError(error.message || 'Failed to load installation');
  }
}

/**
 * Fetch app configuration
 */
async function fetchConfig() {
  const response = await fetch('/api/config');
  if (!response.ok) throw new Error('Failed to load config');
  return response.json();
}

/**
 * Fetch installation data from HubSpot
 */
async function fetchInstallation(id) {
  const url = authToken
    ? `/api/installation/${id}?token=${encodeURIComponent(authToken)}`
    : `/api/installation/${id}`;

  const response = await fetch(url);
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.message || data.error || 'Installation not found');
  }
  return response.json();
}

/**
 * Geocode address to get lat/lng
 */
async function geocodeAddress(address) {
  let url = `/api/geocode?address=${encodeURIComponent(address)}`;

  // Include auth params if available
  if (installationId) {
    url += `&id=${encodeURIComponent(installationId)}`;
  }
  if (authToken) {
    url += `&token=${encodeURIComponent(authToken)}`;
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error('Failed to geocode address');
  }
  return response.json();
}

/**
 * Initialize Fabric.js canvas with satellite imagery
 * @param {string} address - Address to geocode if coordinates not available
 * @param {Object} coordinates - Pre-fetched coordinates {lat, lng} from Place record (optional)
 */
async function initCanvas(address, coordinates = null) {
  const container = document.querySelector('.canvas-container');
  const containerWidth = container.clientWidth;
  const containerHeight = container.clientHeight;

  console.log('Canvas container dimensions:', containerWidth, 'x', containerHeight);

  // Create canvas element
  const canvasEl = document.getElementById('placement-canvas');
  canvasEl.width = containerWidth;
  canvasEl.height = containerHeight;

  // Initialize Fabric.js canvas
  canvas = new fabric.Canvas('placement-canvas', {
    selection: false,
    backgroundColor: '#1a1a2e'
  });

  console.log('Fabric canvas initialized:', canvas.width, 'x', canvas.height);
  console.log('googleMapsApiKey present:', !!googleMapsApiKey);
  console.log('Coordinates:', coordinates);

  // Load satellite image
  if (googleMapsApiKey) {
    try {
      let location;
      // Use pre-fetched coordinates if available, otherwise geocode
      if (coordinates && coordinates.lat && coordinates.lng) {
        location = coordinates;
        console.log('Using pre-fetched coordinates from Place record:', location);
      } else if (address) {
        console.log('Geocoding address:', address);
        location = await geocodeAddress(address);
        console.log('Geocoded address to:', location);
      }

      if (location) {
        console.log('Loading satellite image at:', location.lat, location.lng);
        await loadSatelliteImage(location.lat, location.lng, containerWidth, containerHeight);
        console.log('Satellite image loaded successfully');
      } else {
        console.log('No location available, showing placeholder');
        addPlaceholderBackground(containerWidth, containerHeight);
      }
    } catch (error) {
      console.error('Could not load satellite image:', error);
      // Continue without satellite image - show placeholder
      addPlaceholderBackground(containerWidth, containerHeight);
    }
  } else {
    console.log('No Google Maps API key, showing placeholder');
    addPlaceholderBackground(containerWidth, containerHeight);
  }

  // Force canvas render
  canvas.renderAll();
  console.log('Canvas rendered');

  // Handle canvas tap to place items
  canvas.on('mouse:down', handleCanvasTap);

  // Handle window resize
  window.addEventListener('resize', handleResize);
}

/**
 * Load satellite image from server proxy (avoids CORS issues)
 */
async function loadSatelliteImage(lat, lng, width, height) {
  return new Promise((resolve, reject) => {
    // Use server proxy to fetch satellite image
    const zoom = 20;
    let mapUrl = `/api/satellite?lat=${lat}&lng=${lng}&width=${Math.min(width, 640)}&height=${Math.min(height, 640)}&zoom=${zoom}`;
    
    // Include auth params
    if (installationId) {
      mapUrl += `&id=${encodeURIComponent(installationId)}`;
    }
    if (authToken) {
      mapUrl += `&token=${encodeURIComponent(authToken)}`;
    }

    console.log('Loading satellite image from:', mapUrl);

    // Pre-load image with standard HTML Image to ensure it loads
    const imgElement = new Image();
    imgElement.crossOrigin = 'anonymous';
    
    imgElement.onload = function() {
      console.log('HTML Image loaded:', imgElement.width, 'x', imgElement.height);
      
      // Create Fabric.js image from the loaded HTML image
      const fabricImg = new fabric.Image(imgElement, {
        selectable: false,
        evented: false
      });

      // Scale image to fill canvas
      const scaleX = width / fabricImg.width;
      const scaleY = height / fabricImg.height;
      const scale = Math.max(scaleX, scaleY);

      fabricImg.set({
        scaleX: scale,
        scaleY: scale,
        left: (width - fabricImg.width * scale) / 2,
        top: (height - fabricImg.height * scale) / 2
      });

      canvas.setBackgroundImage(fabricImg, canvas.renderAll.bind(canvas));
      console.log('Satellite image set as background');
      resolve();
    };
    
    imgElement.onerror = function(err) {
      console.error('Failed to load satellite image:', err);
      reject(new Error('Failed to load satellite image'));
    };
    
    imgElement.src = mapUrl;
  });
}

/**
 * Add placeholder background when satellite image unavailable
 */
function addPlaceholderBackground(width, height) {
  // Create a grid pattern as placeholder
  const gridSize = 40;
  const gridColor = '#2a2a4e';

  for (let x = 0; x < width; x += gridSize) {
    canvas.add(new fabric.Line([x, 0, x, height], {
      stroke: gridColor,
      selectable: false,
      evented: false
    }));
  }

  for (let y = 0; y < height; y += gridSize) {
    canvas.add(new fabric.Line([0, y, width, y], {
      stroke: gridColor,
      selectable: false,
      evented: false
    }));
  }

  // Add instruction text
  canvas.add(new fabric.Text('Satellite image unavailable\nTap to place units', {
    left: width / 2,
    top: height / 2,
    fontSize: 16,
    fill: '#6b7280',
    textAlign: 'center',
    originX: 'center',
    originY: 'center',
    selectable: false,
    evented: false
  }));
}

/**
 * Setup tool button handlers
 */
function setupToolHandlers() {
  btnIdu.addEventListener('click', () => selectTool('idu'));
  btnOdu.addEventListener('click', () => selectTool('odu'));
  btnLine.addEventListener('click', () => selectTool('line'));
  btnClear.addEventListener('click', clearAll);
  saveBtn.addEventListener('click', savePlacement);
}

/**
 * Select active tool
 */
function selectTool(tool) {
  currentTool = tool;

  // Update button states
  [btnIdu, btnOdu, btnLine].forEach(btn => btn.classList.remove('active'));

  if (tool === 'idu') btnIdu.classList.add('active');
  else if (tool === 'odu') btnOdu.classList.add('active');
  else if (tool === 'line') btnLine.classList.add('active');

  // Update instructions
  const instructionsEl = document.getElementById('instructions');
  if (tool === 'line') {
    instructionsEl.innerHTML = '<p><strong>Tap</strong> points to draw the line set path. Tap the last point again to finish.</p>';
  } else {
    instructionsEl.innerHTML = '<p><strong>Tap</strong> on the map to place units. <strong>Drag</strong> to reposition.</p>';
  }
}

/**
 * Handle canvas tap to place items
 */
function handleCanvasTap(opt) {
  const pointer = canvas.getPointer(opt.e);

  // If tapped on an existing object, don't place new one
  if (opt.target) return;

  if (currentTool === 'idu') {
    placeUnit('IDU', pointer.x, pointer.y, '#3b82f6');
    iduPlaced = true;
    updateSaveButton();
  } else if (currentTool === 'odu') {
    placeUnit('ODU', pointer.x, pointer.y, '#f97316');
    oduPlaced = true;
    updateSaveButton();
  } else if (currentTool === 'line') {
    addLinePoint(pointer.x, pointer.y);
  }
}

/**
 * Place a unit marker on the canvas
 */
function placeUnit(label, x, y, color) {
  // Remove existing unit of same type
  const existingUnits = canvas.getObjects().filter(obj => obj.unitLabel === label);
  existingUnits.forEach(obj => canvas.remove(obj));

  // Create unit group (rectangle + text)
  const boxWidth = 60;
  const boxHeight = 36;

  const rect = new fabric.Rect({
    width: boxWidth,
    height: boxHeight,
    fill: color,
    rx: 6,
    ry: 6,
    stroke: '#fff',
    strokeWidth: 2,
    originX: 'center',
    originY: 'center'
  });

  const text = new fabric.Text(label, {
    fontSize: 14,
    fontWeight: 'bold',
    fill: '#fff',
    originX: 'center',
    originY: 'center'
  });

  const group = new fabric.Group([rect, text], {
    left: x,
    top: y,
    originX: 'center',
    originY: 'center',
    hasControls: false,
    hasBorders: false,
    lockRotation: true,
    lockScalingX: true,
    lockScalingY: true
  });

  group.unitLabel = label;
  canvas.add(group);
  canvas.renderAll();
}

/**
 * Add a point to the line set path
 */
function addLinePoint(x, y) {
  // Check if clicking near the last point to finish
  if (linePoints.length > 1) {
    const lastPoint = linePoints[linePoints.length - 1];
    const distance = Math.sqrt(Math.pow(x - lastPoint.x, 2) + Math.pow(y - lastPoint.y, 2));
    if (distance < 30) {
      // Finish the line
      finishLine();
      return;
    }
  }

  linePoints.push({ x, y });

  // Draw point marker
  const pointMarker = new fabric.Circle({
    left: x,
    top: y,
    radius: 6,
    fill: '#10b981',
    stroke: '#fff',
    strokeWidth: 2,
    originX: 'center',
    originY: 'center',
    selectable: false,
    evented: false,
    isLinePoint: true
  });
  canvas.add(pointMarker);

  // Draw line segment from previous point
  if (linePoints.length > 1) {
    const prevPoint = linePoints[linePoints.length - 2];
    const lineSegment = new fabric.Line(
      [prevPoint.x, prevPoint.y, x, y],
      {
        stroke: '#10b981',
        strokeWidth: 4,
        strokeDashArray: [8, 4],
        selectable: false,
        evented: false,
        isLineSegment: true
      }
    );
    canvas.add(lineSegment);
    // Move line behind points
    lineSegment.sendToBack();
  }

  canvas.renderAll();
  updateSaveButton();
}

/**
 * Finish drawing the line
 */
function finishLine() {
  if (linePoints.length < 2) return;

  // Visual feedback that line is complete
  const allLines = canvas.getObjects().filter(obj => obj.isLineSegment);
  allLines.forEach(line => {
    line.set({ strokeDashArray: null }); // Solid line when complete
  });

  canvas.renderAll();
  selectTool('idu'); // Switch back to IDU tool
}

/**
 * Clear all annotations
 */
function clearAll() {
  // Remove all placed objects except background
  const objectsToRemove = canvas.getObjects().filter(obj =>
    obj.unitLabel || obj.isLinePoint || obj.isLineSegment
  );
  objectsToRemove.forEach(obj => canvas.remove(obj));

  // Reset state
  iduPlaced = false;
  oduPlaced = false;
  linePoints = [];
  currentLine = null;

  canvas.renderAll();
  updateSaveButton();
}

/**
 * Update save button state
 */
function updateSaveButton() {
  // Enable save if at least one unit is placed
  const canSave = iduPlaced || oduPlaced;
  saveBtn.disabled = !canSave;
}

/**
 * Save placement map to HubSpot
 */
async function savePlacement() {
  if (saveBtn.disabled) return;

  const saveText = saveBtn.querySelector('.save-text');
  const saveSpinner = saveBtn.querySelector('.save-spinner');

  try {
    // Show loading state
    saveBtn.disabled = true;
    saveText.textContent = 'Saving...';
    saveSpinner.classList.remove('hidden');

    // Export canvas to PNG blob
    const dataUrl = canvas.toDataURL({
      format: 'png',
      quality: 1
    });

    // Convert data URL to blob
    const response = await fetch(dataUrl);
    const blob = await response.blob();

    // Create form data
    const formData = new FormData();
    formData.append('image', blob, 'site-plan.png');

    // Upload to server (include auth token if present)
    const uploadUrl = authToken
      ? `/api/installation/${installationId}/placement?token=${encodeURIComponent(authToken)}`
      : `/api/installation/${installationId}/placement`;

    const uploadResponse = await fetch(uploadUrl, {
      method: 'POST',
      body: formData
    });

    if (!uploadResponse.ok) {
      const error = await uploadResponse.json();
      throw new Error(error.error || 'Upload failed');
    }

    // Show success modal
    successModal.classList.remove('hidden');

  } catch (error) {
    console.error('Save error:', error);
    alert('Failed to save: ' + error.message);

    // Reset button
    saveBtn.disabled = false;
    saveText.textContent = 'Save Site Plan';
    saveSpinner.classList.add('hidden');
  }
}

/**
 * Close success modal
 */
function closeSuccessModal() {
  successModal.classList.add('hidden');

  // Reset button
  const saveText = saveBtn.querySelector('.save-text');
  const saveSpinner = saveBtn.querySelector('.save-spinner');
  saveBtn.disabled = false;
  saveText.textContent = 'Save Site Plan';
  saveSpinner.classList.add('hidden');
}

// Make closeSuccessModal available globally
window.closeSuccessModal = closeSuccessModal;

/**
 * Handle window resize
 */
function handleResize() {
  const container = document.querySelector('.canvas-container');
  const width = container.clientWidth;
  const height = container.clientHeight;

  canvas.setWidth(width);
  canvas.setHeight(height);
  canvas.renderAll();
}

/**
 * Show error state
 */
function showError(message) {
  loadingEl.classList.add('hidden');
  mainEl.classList.add('hidden');
  errorMessageEl.textContent = message;
  errorEl.classList.remove('hidden');
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', init);
