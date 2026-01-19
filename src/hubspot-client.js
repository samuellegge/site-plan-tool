import { Client } from '@hubspot/api-client';
import FormData from 'form-data';
import https from 'https';

const INSTALLATION_OBJECT_ID = '2-31703261';
const PLACE_OBJECT_ID = process.env.HUBSPOT_PLACE_OBJECT_ID;

const INSTALLATION_PROPERTIES = [
  'hs_object_id',
  'name',
  'address',
  'city',
  'state',
  'zip',
  'site_plan_url',
  'hs_pipeline_stage'
];

const PLACE_PROPERTIES = [
  'hs_object_id',
  'name',
  'address',
  'street_address_line_2',
  'city',
  'state',
  'zip'
];

let hubspotClient = null;

export function initHubSpotClient(accessToken) {
  if (!accessToken) {
    throw new Error('HUBSPOT_ACCESS_TOKEN is required');
  }
  hubspotClient = new Client({ accessToken });
  return hubspotClient;
}

export function getClient() {
  if (!hubspotClient) {
    throw new Error('HubSpot client not initialized. Call initHubSpotClient first.');
  }
  return hubspotClient;
}

/**
 * Fetch an installation record by ID, including associated Place address
 */
export async function getInstallationById(installationId) {
  try {
    const client = getClient();
    const response = await client.crm.objects.basicApi.getById(
      INSTALLATION_OBJECT_ID,
      installationId,
      INSTALLATION_PROPERTIES
    );
    
    const installation = response.properties;
    
    // Try to get associated Place for full address
    if (PLACE_OBJECT_ID) {
      try {
        const place = await getAssociatedPlace(installationId);
        if (place) {
          // Use Place address if Installation doesn't have one
          if (!installation.address && place.name) {
            installation.address = place.name;
          }
          if (!installation.city && place.city) {
            installation.city = place.city;
          }
          if (!installation.state && place.state) {
            installation.state = place.state;
          }
          if (!installation.zip && place.zip) {
            installation.zip = place.zip;
          }
        }
      } catch (placeError) {
        console.warn('Could not fetch associated Place:', placeError.message);
      }
    }
    
    return installation;
  } catch (error) {
    console.error('Error fetching installation:', error.message);
    throw error;
  }
}

/**
 * Get the associated Place for an installation
 */
async function getAssociatedPlace(installationId) {
  try {
    const client = getClient();
    
    // Get associations from Installation to Place
    const associations = await client.crm.associations.v4.basicApi.getPage(
      INSTALLATION_OBJECT_ID,
      installationId,
      PLACE_OBJECT_ID,
      undefined,
      1
    );
    
    if (associations.results && associations.results.length > 0) {
      const placeId = associations.results[0].toObjectId;
      
      // Fetch the Place object
      const placeResponse = await client.crm.objects.basicApi.getById(
        PLACE_OBJECT_ID,
        placeId,
        PLACE_PROPERTIES
      );
      
      return placeResponse.properties;
    }
    
    return null;
  } catch (error) {
    console.warn('Error fetching associated place:', error.message);
    return null;
  }
}

/**
 * Get the full address string from installation properties
 */
export function getFullAddress(installation) {
  const parts = [
    installation.address,
    installation.city,
    installation.state,
    installation.zip
  ].filter(Boolean);

  return parts.join(', ');
}

/**
 * Upload a file (image) to HubSpot File Manager
 */
export async function uploadFileToHubSpot(fileBuffer, fileName, accessToken) {
  return new Promise((resolve, reject) => {
    const form = new FormData();

    form.append('file', fileBuffer, {
      filename: fileName,
      contentType: 'image/png'
    });

    form.append('options', JSON.stringify({
      access: 'PRIVATE'
    }));

    form.append('folderPath', '/site-plans');

    const options = {
      hostname: 'api.hubapi.com',
      path: '/files/v3/files',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        ...form.getHeaders()
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode === 201 || res.statusCode === 200) {
            resolve({
              fileId: parsed.id,
              url: parsed.url
            });
          } else {
            reject(new Error(parsed.message || `HTTP ${res.statusCode}: ${data}`));
          }
        } catch (err) {
          reject(new Error(`Parse error: ${err.message}`));
        }
      });
    });

    req.on('error', reject);
    form.pipe(req);
  });
}

/**
 * Create a note engagement with file attachment on an installation
 */
export async function attachFileToInstallation(installationId, fileId, fileName, accessToken) {
  return new Promise((resolve, reject) => {
    const noteData = JSON.stringify({
      engagement: {
        active: true,
        type: 'NOTE'
      },
      metadata: {
        body: `Site Plan: ${fileName}\n\nIDU and ODU locations marked by field technician.`
      },
      attachments: [
        { id: fileId }
      ]
    });

    const options = {
      hostname: 'api.hubapi.com',
      path: '/engagements/v1/engagements',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(noteData)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', async () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode === 200 || res.statusCode === 201) {
            // Now associate the engagement with the installation
            const engagementId = parsed.engagement.id;
            await associateEngagementToInstallation(engagementId, installationId, accessToken);
            resolve(parsed);
          } else {
            reject(new Error(parsed.message || `HTTP ${res.statusCode}: ${data}`));
          }
        } catch (err) {
          reject(new Error(`Parse error: ${err.message}`));
        }
      });
    });

    req.on('error', reject);
    req.write(noteData);
    req.end();
  });
}

/**
 * Associate an engagement with an installation using v4 associations API
 */
async function associateEngagementToInstallation(engagementId, installationId, accessToken) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.hubapi.com',
      path: `/crm/v4/objects/notes/${engagementId}/associations/${INSTALLATION_OBJECT_ID}/${installationId}`,
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    };

    const body = JSON.stringify([
      {
        associationCategory: 'HUBSPOT_DEFINED',
        associationTypeId: 190  // Note to custom object association
      }
    ]);

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data ? JSON.parse(data) : {});
        } else {
          // Try with a different approach if this fails
          console.log('Association response:', res.statusCode, data);
          resolve({}); // Don't fail the whole upload
        }
      });
    });

    req.on('error', (err) => {
      console.error('Association error:', err.message);
      resolve({}); // Don't fail the whole upload
    });

    req.write(body);
    req.end();
  });
}

/**
 * Update installation with site plan URL
 */
export async function updateInstallationUrl(installationId, url) {
  try {
    const client = getClient();
    await client.crm.objects.basicApi.update(
      INSTALLATION_OBJECT_ID,
      installationId,
      {
        properties: {
          site_plan_url: url
        }
      }
    );
    return { success: true };
  } catch (error) {
    console.error('Error updating installation URL:', error.message);
    throw error;
  }
}
