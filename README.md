# Sports Court Booking

This app can run in two modes:

- `file` mode for local testing with `data/bookings.json`
- `supabase` mode for real online deployment with durable shared storage

## Run locally

```bash
node server.js
```

Then open `http://localhost:3000`.

## Deploy online

This project is ready to deploy to a Node host like Render or Railway.

### 1. Push the folder to GitHub

Include:

- `index.html`
- `styles.css`
- `app.js`
- `server.js`
- `package.json`

### 2. Create a Supabase table

Create a table named `bookings` with these columns:

- `id` text primary key
- `name` text
- `email` text
- `date` text
- `start_time` text
- `end_time` text
- `sport` text

### 3. Add environment variables in your host

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_TABLE=bookings`

### 4. Deploy

Use:

- Build command: none
- Start command: `npm start`

The server automatically uses Supabase when those environment variables are present. Otherwise it falls back to the local JSON file.
