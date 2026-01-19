# Site Plan Tool

Mobile-first web tool for field technicians to mark Indoor Unit (IDU) and Outdoor Unit (ODU) placement locations on a satellite view of customer properties.

## Features

- **Satellite Imagery**: Loads Google Maps satellite view of customer address
- **Draggable Markers**: Place and reposition IDU (blue) and ODU (orange) markers
- **Line Set Path**: Draw the refrigerant line path between units
- **Auto-Upload**: Saves annotated image directly to HubSpot installation record
- **Mobile-First**: Optimized for phone/tablet use in the field

## Quick Start

### 1. Install Dependencies

```bash
cd development/site-plan-tool
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

```
HUBSPOT_ACCESS_TOKEN=your_hubspot_private_app_token
GOOGLE_MAPS_API_KEY=your_google_maps_api_key
PORT=3000
```

### 3. Run Locally

```bash
npm start
```

Open: `http://localhost:3000/?id=YOUR_INSTALLATION_ID`

## Deployment on Replit

1. Create a new Replit with Node.js template
2. Upload all files from this directory
3. Set environment variables (Secrets):
   - `HUBSPOT_ACCESS_TOKEN`
   - `GOOGLE_MAPS_API_KEY`
4. Click Run

The app will be available at your Replit URL: `https://your-app.replit.app/?id=INSTALLATION_ID`

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/config` | GET | Returns client-side config (Maps API key) |
| `/api/installation/:id` | GET | Fetch installation details from HubSpot |
| `/api/installation/:id/placement` | POST | Upload site plan image |
| `/api/geocode?address=...` | GET | Geocode address to lat/lng |

## URL Format

```
https://your-app-url.com/?id=INSTALLATION_ID
```

The installation ID is the HubSpot custom object record ID.

## HubSpot Setup

### Required Property

Add a property to the Installations custom object:
- **Name**: `site_plan_url`
- **Type**: Single-line text
- **Label**: Site Plan URL

### Workflow for New Installations

Create a workflow that triggers when an Installation is created:
1. Trigger: Installation is created
2. Action: Set property `site_plan_url` to:
   ```
   https://your-app-url.com/?id={{hs_object_id}}
   ```

### Required API Scopes

Your HubSpot private app needs these scopes:
- `crm.objects.custom.read` - Read installation records
- `files` - Upload files to File Manager
- `crm.objects.contacts.write` - Create note engagements

## How It Works

1. Tech opens link from HubSpot installation record
2. App fetches address and loads satellite imagery
3. Tech taps to place IDU marker (blue box)
4. Tech taps to place ODU marker (orange box)
5. Tech draws line set path connecting them
6. Tech taps "Save Placement"
7. Canvas is exported as PNG and uploaded to HubSpot
8. Image is attached to the installation as a note

## Project Structure

```
site-plan-tool/
├── server.js           # Express backend
├── src/
│   └── hubspot-client.js   # HubSpot API integration
├── public/
│   ├── index.html      # Main app page
│   ├── style.css       # Mobile-first styles
│   └── app.js          # Fabric.js canvas logic
├── package.json
└── README.md
```

## Troubleshooting

### "Installation not found"
- Verify the installation ID exists in HubSpot
- Check that your HubSpot token has `crm.objects.custom.read` scope

### "Failed to geocode address"
- Verify your Google Maps API key is valid
- Ensure the Geocoding API is enabled in Google Cloud Console
- Check the installation has a valid address

### "Upload failed"
- Verify your HubSpot token has `files` scope
- Check the token has write permissions

### Satellite image not loading
- Verify Google Maps API key has Static Maps API enabled
- Check browser console for CORS errors
- Fallback grid pattern will be shown if satellite fails

## Development

Run with auto-reload:

```bash
npm run dev
```

## License

Internal Jetson Home tool - not for distribution.
