# Site Plan Tool

## Overview
Mobile-first web tool for field technicians to mark Indoor Unit (IDU) and Outdoor Unit (ODU) placement locations on satellite views of customer properties. The tool integrates with HubSpot for installation data and file storage.

## Project Architecture
- **Backend**: Node.js + Express server (server.js)
- **Frontend**: Vanilla HTML/CSS/JavaScript with Fabric.js for canvas manipulation
- **API Integrations**: HubSpot (CRM data, file storage), Google Maps (satellite imagery, geocoding)

## Project Structure
```
site-plan-tool/
├── server.js               # Express backend server (port 5000)
├── src/
│   └── hubspot-client.js   # HubSpot API client wrapper
├── public/
│   ├── index.html          # Main app page
│   ├── style.css           # Mobile-first styles
│   └── app.js              # Fabric.js canvas logic
├── package.json            # Node.js dependencies
└── replit.md               # Project documentation
```

## Required Environment Variables (Secrets)
- `HUBSPOT_ACCESS_TOKEN` - HubSpot private app access token
- `GOOGLE_MAPS_API_KEY` - Google Maps API key (for satellite imagery and geocoding)
- `SITE_PLAN_SECRET` - Secret for generating signed authentication tokens (optional, enables secure URL signing)
- `BASE_URL` - Base URL for generating signed links (optional)

## HubSpot Configuration
- Custom Object Schema ID: `2-31703261` (Installations)

## Development
The server runs on port 5000 with:
```bash
npm start
```

## Usage
Access the app with an installation ID:
```
https://your-app-url/?id=INSTALLATION_ID&token=AUTH_TOKEN
```

For development/testing without HubSpot:
```
https://your-app-url/?demo=true
```
