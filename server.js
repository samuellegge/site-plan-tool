import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

import {
  initHubSpotClient,
  getInstallationById,
  getFullAddress,
  uploadFileToHubSpot,
  attachFileToInstallation
} from './src/hubspot-client.js';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Configuration
const HUBSPOT_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN;
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const SITE_PLAN_SECRET = process.env.SITE_PLAN_SECRET;

// Token expiry: 7 days in milliseconds
const TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

if (HUBSPOT_TOKEN) {
  initHubSpotClient(HUBSPOT_TOKEN);
  console.log('HubSpot client initialized');
} else {
  console.warn('Warning: HUBSPOT_ACCESS_TOKEN not set. API calls will fail.');
}

if (!SITE_PLAN_SECRET) {
  console.warn('Warning: SITE_PLAN_SECRET not set. Authentication disabled (development mode).');
}

// ============================================================================
// Authentication Helpers
// ============================================================================

/**
 * Generate a signed token for an installation ID
 * Token format: base64(expiry:signature)
 * where signature = HMAC-SHA256(secret, installationId + expiry)
 */
export function generateSignedToken(installationId, secret = SITE_PLAN_SECRET) {
  if (!secret) {
    throw new Error('SITE_PLAN_SECRET is required to generate tokens');
  }

  const expiry = Date.now() + TOKEN_EXPIRY_MS;
  const data = `${installationId}:${expiry}`;
  const signature = crypto
    .createHmac('sha256', secret)
    .update(data)
    .digest('hex');

  // Encode as base64 for URL safety
  const token = Buffer.from(`${expiry}:${signature}`).toString('base64url');
  return token;
}

/**
 * Verify a signed token for an installation ID
 * Returns { valid: boolean, error?: string }
 */
function verifySignedToken(installationId, token, secret = SITE_PLAN_SECRET) {
  if (!secret) {
    // Development mode: skip authentication
    return { valid: true };
  }

  if (!token) {
    return { valid: false, error: 'Missing authentication token' };
  }

  try {
    // Decode the token
    const decoded = Buffer.from(token, 'base64url').toString('utf8');
    const [expiryStr, providedSignature] = decoded.split(':');
    const expiry = parseInt(expiryStr, 10);

    // Check expiry
    if (isNaN(expiry) || Date.now() > expiry) {
      return { valid: false, error: 'Token has expired' };
    }

    // Verify signature
    const data = `${installationId}:${expiry}`;
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(data)
      .digest('hex');

    if (!crypto.timingSafeEqual(
      Buffer.from(providedSignature, 'hex'),
      Buffer.from(expectedSignature, 'hex')
    )) {
      return { valid: false, error: 'Invalid token signature' };
    }

    return { valid: true };
  } catch (error) {
    return { valid: false, error: 'Invalid token format' };
  }
}

/**
 * Middleware to verify authentication token
 * Accepts id from either URL params or query string
 */
function requireAuth(req, res, next) {
  const id = req.params.id || req.query.id;
  const { token } = req.query;

  const result = verifySignedToken(id, token);

  if (!result.valid) {
    return res.status(403).json({
      error: 'Access denied',
      message: result.error
    });
  }

  next();
}

// ============================================================================
// API Routes
// ============================================================================

/**
 * GET /api/config
 * Returns client-side configuration (Google Maps API key)
 */
app.get('/api/config', (req, res) => {
  res.json({
    googleMapsApiKey: GOOGLE_MAPS_API_KEY || null
  });
});

/**
 * GET /api/installation/:id
 * Fetch installation details including address
 * Requires valid signed token
 */
app.get('/api/installation/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    if (!HUBSPOT_TOKEN) {
      return res.status(500).json({ error: 'HubSpot not configured' });
    }

    const installation = await getInstallationById(id);
    const fullAddress = getFullAddress(installation);

    res.json({
      id,
      name: installation.name,
      address: fullAddress,
      addressParts: {
        street: installation.address,
        city: installation.city,
        state: installation.state,
        zip: installation.zip
      }
    });
  } catch (error) {
    console.error('Error fetching installation:', error);
    res.status(404).json({ error: 'Installation not found' });
  }
});

/**
 * POST /api/installation/:id/placement
 * Upload placement map image and attach to installation
 * Requires valid signed token
 */
app.post('/api/installation/:id/placement', requireAuth, upload.single('image'), async (req, res) => {
  try {
    const { id } = req.params;

    if (!HUBSPOT_TOKEN) {
      return res.status(500).json({ error: 'HubSpot not configured' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No image provided' });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `site-plan-${id}-${timestamp}.png`;

    console.log(`Uploading site plan for installation ${id}...`);

    // Upload file to HubSpot
    const { fileId, url } = await uploadFileToHubSpot(
      req.file.buffer,
      fileName,
      HUBSPOT_TOKEN
    );

    console.log(`File uploaded with ID: ${fileId}`);

    // Attach to installation as a note
    await attachFileToInstallation(id, fileId, fileName, HUBSPOT_TOKEN);

    console.log(`Site plan attached to installation ${id}`);

    res.json({
      success: true,
      fileId,
      fileName,
      message: 'Site plan saved successfully'
    });
  } catch (error) {
    console.error('Error saving site plan:', error);
    res.status(500).json({ error: error.message || 'Failed to save site plan' });
  }
});

/**
 * GET /api/geocode
 * Geocode an address to lat/lng using Google Maps
 * Requires valid signed token (pass id and token as query params)
 */
app.get('/api/geocode', requireAuth, async (req, res) => {
  try {
    const { address } = req.query;

    if (!address) {
      return res.status(400).json({ error: 'Address is required' });
    }

    if (!GOOGLE_MAPS_API_KEY) {
      return res.status(500).json({ error: 'Google Maps API not configured' });
    }

    const encodedAddress = encodeURIComponent(address);
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodedAddress}&key=${GOOGLE_MAPS_API_KEY}`;

    const response = await fetch(url);
    const data = await response.json();

    if (data.status !== 'OK' || !data.results?.length) {
      return res.status(404).json({ error: 'Address not found' });
    }

    const location = data.results[0].geometry.location;

    res.json({
      lat: location.lat,
      lng: location.lng,
      formattedAddress: data.results[0].formatted_address
    });
  } catch (error) {
    console.error('Geocoding error:', error);
    res.status(500).json({ error: 'Geocoding failed' });
  }
});

/**
 * GET /api/generate-url/:id
 * Generate a signed URL for an installation (admin/internal use)
 * This would typically be called from a HubSpot workflow or internal tool
 */
app.get('/api/generate-url/:id', (req, res) => {
  try {
    const { id } = req.params;

    if (!SITE_PLAN_SECRET) {
      return res.status(500).json({
        error: 'SITE_PLAN_SECRET not configured',
        message: 'Cannot generate signed URLs without a secret'
      });
    }

    const token = generateSignedToken(id);
    const baseUrl = process.env.BASE_URL || `http://localhost:${PORT}`;
    const signedUrl = `${baseUrl}/?id=${id}&token=${token}`;

    res.json({
      installationId: id,
      signedUrl,
      expiresIn: '7 days'
    });
  } catch (error) {
    console.error('Error generating URL:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /
 * Serve the main app (with optional installation ID)
 */
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Site Plan Tool running on http://localhost:${PORT}`);
  console.log(`\nTest URL: http://localhost:${PORT}/?id=YOUR_INSTALLATION_ID&token=YOUR_TOKEN`);

  if (!SITE_PLAN_SECRET) {
    console.log('\n[DEV MODE] Authentication disabled - set SITE_PLAN_SECRET to enable');
  }
});
