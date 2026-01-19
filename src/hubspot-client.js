import { Client } from '@hubspot/api-client';
import FormData from 'form-data';
import https from 'https';

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
 * Fetch an installation record by ID
 */
export async function getInstallationById(installationId) {
  try {
    const client = getClient();
    const response = await client.crm.objects.basicApi.getById(
      '2-31703261',
      installationId,
      INSTALLATION_PROPERTIES
    );
    return response.properties;
  } catch (error) {
    console.error('Error fetching installation:', error.message);
    throw error;
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
      path: `/crm/v4/objects/notes/${engagementId}/associations/2-31703261/${installationId}`,
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
      '2-31703261',
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
