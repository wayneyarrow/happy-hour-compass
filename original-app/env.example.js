/**
 * Happy Hour Compass — Environment Configuration
 *
 * Copy this file to env.js and fill in your values.
 * env.js is gitignored and must never be committed to source control.
 *
 * REQUIRED FOR GOOGLE MAPS:
 *   GOOGLE_MAPS_API_KEY — A valid Google Maps JavaScript API key.
 *   Obtain one from https://console.cloud.google.com/google/maps-apis
 *   Enable the "Maps JavaScript API" for your project.
 *
 * BEHAVIOR WITHOUT THE KEY:
 *   If env.js is missing or GOOGLE_MAPS_API_KEY is empty, the app will
 *   display a placeholder message where maps would normally appear.
 *   All other functionality (venue listings, filters, distance, etc.)
 *   remains fully operational.
 *
 * VERCEL / CI DEPLOYMENT:
 *   Set GOOGLE_MAPS_API_KEY as an environment variable in your hosting
 *   platform (e.g., Vercel dashboard → Settings → Environment Variables).
 *   Then add a build command that generates env.js:
 *
 *     echo "window.HHC_CONFIG={GOOGLE_MAPS_API_KEY:'$GOOGLE_MAPS_API_KEY'};" > env.js
 *
 * FUTURE HARDENING (not required for Beta):
 *   - Restrict the API key to specific HTTP referrers in Google Cloud Console
 *   - Set a daily quota / billing cap to prevent unexpected charges
 *   - Consider using a Maps API key that is restricted to Maps JavaScript API only
 */
window.HHC_CONFIG = {
  GOOGLE_MAPS_API_KEY: ''
};
