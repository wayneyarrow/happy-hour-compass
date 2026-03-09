# Happy Hour Compass

Find your direction. Find your drink.

A mobile-first web application that helps users discover happy hour deals and special events at local restaurants and bars.

## What this app does

Happy Hour Compass makes it easy to find the best food and drink deals near you:

- **Browse active happy hours** - See which venues have deals happening right now, with real-time countdowns showing when each happy hour ends
- **Search and filter** - Find venues by category (sports bars, fine dining, casual dining), price range, and current status
- **Map and list views** - Toggle between a list view with detailed information and an interactive map showing all nearby venues
- **Save favorites** - Keep track of your go-to spots with the favorites feature
- **Discover events** - Find weekly recurring events like trivia nights, wine tastings, and game day specials
- **Request venues** - Don't see your favorite spot? Submit a request to have it added to the app

## Tech stack

- **HTML5** - Semantic markup and structure
- **CSS3** - Custom styling with modern features (flexbox, gradients, animations)
- **Vanilla JavaScript** - Interactive functionality and state management
- **Leaflet.js** - Interactive maps for venue discovery and location display
- **OpenStreetMap** - Map tile provider for geographical data

## Deployment Troubleshooting

### Supabase "Invalid API key" error

If Vercel runtime logs show "Invalid API key" and the consumer app loads with no venues or events:

1. Open Supabase → Project Settings → API
2. Copy the **Secret Key**
3. Go to Vercel → Project → Settings → Environment Variables
4. Ensure `SUPABASE_SECRET_KEY` matches the Supabase secret key exactly
5. Remove any accidental prefix such as `SUPABASE_SECRET_KEY=` from the value
6. Redeploy the latest deployment in Vercel

**Notes:**
- Even a single incorrect character (O vs 0, etc.) will cause authentication failure.
- Environment variable changes require a redeploy before taking effect.