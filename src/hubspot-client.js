import { Client } from '@hubspot/api-client';
import FormData from 'form-data';
import https from 'https';

const INSTALLATION_OBJECT_ID = '2-31703261';
const PLACE_OBJECT_ID = '2-36857150';

const INSTALLATION_PROPERTIES = [
  'hs_object_id',
  'installation_name',
  'place_address_line_1',
  'place_full_address',
  'city',
  'state',
  'zip',
  'place_latitude',
  'place_longitude',
  'site_plan_url',
  'hs_pipeline_stage'
];

const PLACE_PROPERTIES = [
  'hs_object_id',
  'full_address',
  'address_line_2',
  'address_city',
  'state_province_region',
  'address_zip',
  'latitude',
  'longitude'
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

    const props = response.properties;

    // Normalize property names for consistent API response
    // Installation now has Place data synced to these properties
    const installation = {
      name: props.installation_name,
      address: props.place_address_line_1 || props.place_full_address,
      city: props.city,
      state: props.state,
      zip: props.zip,
      latitude: props.place_latitude ? parseFloat(props.place_latitude) : null,
      longitude: props.place_longitude ? parseFloat(props.place_longitude) : null,
      site_plan_url: props.site_plan_url,
      hs_pipeline_stage: props.hs_pipeline_stage
    };

    // If we don't have address data from Installation, try to get associated Place
    if (!installation.address && PLACE_OBJECT_ID) {
      try {
        const place = await getAssociatedPlace(installationId);
        if (place) {
          // Use Place address data
          if (!installation.address && place.full_address) {
            installation.address = place.full_address;
          }
          if (!installation.city && place.address_city) {
            installation.city = place.address_city;
          }
          if (!installation.state && place.state_province_region) {
            installation.state = place.state_province_region;
          }
          if (!installation.zip && place.address_zip) {
            installation.zip = place.address_zip;
          }
          if (!installation.latitude && place.latitude) {
            installation.latitude = parseFloat(place.latitude);
          }
          if (!installation.longitude && place.longitude) {
            installation.longitude = parseFloat(place.longitude);
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
